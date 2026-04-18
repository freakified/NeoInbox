import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { Category, RawMessage } from "../shared/types";
import { CATEGORIES } from "../shared/categories";
import {
  loadInboxMessages,
  sendDone,
  sendPin,
  sendSnooze,
  triggerBackfill,
} from "./data/loadMessages";

// ─── date bucketing ────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateBucket(epochMs: number): string {
  const d = new Date(epochMs);
  const now = new Date();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  if (d >= weekStart) return "This week";
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  if (d >= lastWeekStart) return "Last week";
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (d >= monthStart) return "This month";
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("en-US", { month: "long" });
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ─── stream model ──────────────────────────────────────────────────────────

type StreamItem =
  | { type: "message"; date: number; message: RawMessage }
  | { type: "bundle"; date: number; category: Category; sliceMessages: RawMessage[] };

interface DateGroup {
  label: string;
  items: StreamItem[];
}

function buildDateGroups(messages: RawMessage[]): DateGroup[] {
  const bucketById = new Map(messages.map((m) => [m.id, dateBucket(m.date)]));
  const bucketOrder: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    const b = bucketById.get(m.id)!;
    if (!seen.has(b)) { bucketOrder.push(b); seen.add(b); }
  }
  return bucketOrder.map((label) => {
    const inBucket = messages.filter((m) => bucketById.get(m.id) === label);
    const byCategory = new Map<Category, RawMessage[]>();
    const personal: RawMessage[] = [];
    for (const m of inBucket) {
      if (m.category) {
        const arr = byCategory.get(m.category) ?? [];
        arr.push(m);
        byCategory.set(m.category, arr);
      } else {
        personal.push(m);
      }
    }
    const items: StreamItem[] = [
      ...Array.from(byCategory.entries()).map(([category, msgs]) => ({
        type: "bundle" as const,
        date: msgs[0].date,
        category,
        sliceMessages: msgs,
      })),
      ...personal.map((m) => ({ type: "message" as const, date: m.date, message: m })),
    ].sort((a, b) => b.date - a.date);
    return { label, items };
  });
}

// Flat date grouping — no bundle splitting, used inside expanded bundles
function buildFlatDateGroups(messages: RawMessage[]): { label: string; messages: RawMessage[] }[] {
  const bucketById = new Map(messages.map((m) => [m.id, dateBucket(m.date)]));
  const bucketOrder: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    const b = bucketById.get(m.id)!;
    if (!seen.has(b)) { bucketOrder.push(b); seen.add(b); }
  }
  return bucketOrder.map((label) => ({
    label,
    messages: messages.filter((m) => bucketById.get(m.id) === label),
  }));
}

// ─── snooze presets ────────────────────────────────────────────────────────

function snoozePresets(): { label: string; wakeAt: number }[] {
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
  nextWeek.setHours(9, 0, 0, 0);
  return [
    { label: "1 hour", wakeAt: now + 3_600_000 },
    { label: "3 hours", wakeAt: now + 10_800_000 },
    { label: "Tomorrow 9 am", wakeAt: tomorrow.getTime() },
    { label: "Next week", wakeAt: nextWeek.getTime() },
  ];
}

// ─── MIME + iframe helpers ─────────────────────────────────────────────────

function extractHtmlBody(part: messenger.messages.MessagePart): string | null {
  if (part.contentType === "text/html") return part.body ?? null;
  for (const p of part.parts ?? []) { const f = extractHtmlBody(p); if (f) return f; }
  return null;
}
function extractTextBody(part: messenger.messages.MessagePart): string | null {
  if (part.contentType === "text/plain") {
    const esc = (part.body ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc}</pre>`;
  }
  for (const p of part.parts ?? []) { const f = extractTextBody(p); if (f) return f; }
  return null;
}

const BASE_CSS = `<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       font-size:14px;margin:0;padding:8px;color:#111;word-break:break-word}
  img{max-width:100%;height:auto}a{color:#1a73e8}
  blockquote{border-left:3px solid #ddd;margin:0 0 0 8px;padding-left:8px;color:#555}
  table{border-collapse:collapse}
</style>`;

function buildSrcdoc(rawHtml: string, showImages: boolean): string {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  doc.querySelectorAll("script, noscript").forEach((el) => el.remove());
  if (!showImages) {
    doc.querySelectorAll("img").forEach((img) => {
      if (img.src && !img.src.startsWith("data:")) {
        img.dataset.src = img.src; img.removeAttribute("src"); img.removeAttribute("srcset");
      }
    });
    doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      const s = el.style.backgroundImage;
      if (s && s !== "none") { el.dataset.bgimg = s; el.style.backgroundImage = "none"; }
    });
  }
  doc.head.insertAdjacentHTML("afterbegin", BASE_CSS);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

// ─── avatar helpers ────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#4285F4","#EA4335","#FBBC04","#34A853","#9C27B0",
  "#FF6D01","#00BCD4","#795548","#607D8B","#E91E63",
];
function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xfffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function senderName(author: string): string {
  const m = author.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : author.replace(/<[^>]+>/g, "").trim() || author;
}
function senderInitial(author: string): string {
  return senderName(author).charAt(0).toUpperCase() || "?";
}

// ─── shared types ──────────────────────────────────────────────────────────

type Actions = {
  onPin: (m: RawMessage) => void;
  onDone: (m: RawMessage) => void;
  onSnooze: (m: RawMessage, wakeAt: number) => void;
};

// ─── App ───────────────────────────────────────────────────────────────────

export function App() {
  const [messages, setMessages] = useState<RawMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    loadInboxMessages()
      .then((m) => { setMessages(m); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (expandedKey) {
      expandedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedKey]);

  const onBackfill = async () => {
    setBusy(true);
    try { await triggerBackfill(); load(); } finally { setBusy(false); }
  };

  const optimisticRemove = (id: number) =>
    setMessages((prev) => prev?.filter((m) => m.id !== id) ?? null);
  const optimisticTogglePin = (id: number, pinned: boolean) =>
    setMessages((prev) => prev?.map((m) => (m.id === id ? { ...m, pinned } : m)) ?? null);

  const onPin = async (m: RawMessage) => { optimisticTogglePin(m.id, !m.pinned); await sendPin(m.id, !m.pinned); };
  const onDone = async (m: RawMessage) => { optimisticRemove(m.id); await sendDone(m.id, m.accountId); };
  const onSnooze = async (m: RawMessage, wakeAt: number) => { optimisticRemove(m.id); await sendSnooze(m.id, wakeAt); };

  const actions: Actions = { onPin, onDone, onSnooze };
  const all = messages ?? [];
  const pinned = all.filter((m) => m.pinned);
  const unpinned = all.filter((m) => !m.pinned);

  // all messages per category — passed to bundle rows so they show every message when open
  const allByCategory = useMemo(() => {
    const map = new Map<Category, RawMessage[]>();
    for (const m of unpinned) {
      if (m.category) {
        const arr = map.get(m.category) ?? [];
        arr.push(m);
        map.set(m.category, arr);
      }
    }
    return map;
  }, [unpinned]);

  const toggleKey = (key: string) =>
    setExpandedKey((prev) => (prev === key ? null : key));

  return (
    <div
      className="min-h-screen bg-neutral-100"
      onClick={(e) => {
        if (!expandedKey) return;
        if (!(e.target as HTMLElement).closest("[data-row]")) {
          setExpandedKey(null);
        }
      }}
    >
      <header className="sticky top-0 z-20 bg-white border-b border-neutral-200 px-4 py-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold">NeoInbox</h1>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="text-sm px-3 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50">
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button onClick={onBackfill} disabled={busy}
            className="text-sm px-3 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50">
            {busy ? "Classifying…" : "Re-classify"}
          </button>
        </div>
      </header>

      {error && <div className="max-w-3xl mx-auto px-4 mt-4 text-red-600 text-sm">Error: {error}</div>}

      <div className="max-w-5xl mx-auto py-6 px-8">
        {messages !== null && (
          <>
            {pinned.length > 0 && (
              <section className="mb-6">
                <div className="max-w-3xl mx-auto"><SectionLabel>Pinned</SectionLabel></div>
                <LayoutGroup>
                  <div className="flex flex-col">
                    {pinned.map((m) => (
                      <MessageRow
                        key={m.id}
                        message={m}
                        isExpanded={expandedKey === `msg:${m.id}`}
                        onToggleExpand={() => toggleKey(`msg:${m.id}`)}
                        expandedRef={expandedRef}
                        {...actions}
                      />
                    ))}
                  </div>
                </LayoutGroup>
              </section>
            )}

            {buildDateGroups(unpinned).map((group) => (
              <section key={group.label} className="mb-6">
                <div className="max-w-3xl mx-auto"><SectionLabel>{group.label}</SectionLabel></div>
                <LayoutGroup>
                  <div className="flex flex-col">
                    {group.items.map((item) =>
                      item.type === "message" ? (
                        <MessageRow
                          key={item.message.id}
                          message={item.message}
                          isExpanded={expandedKey === `msg:${item.message.id}`}
                          onToggleExpand={() => toggleKey(`msg:${item.message.id}`)}
                          expandedRef={expandedRef}
                          {...actions}
                        />
                      ) : (
                        <BundleSliceRow
                          key={`${group.label}|${item.category}`}
                          bundleKey={`bundle:${group.label}|${item.category}`}
                          category={item.category}
                          allMessages={allByCategory.get(item.category) ?? item.sliceMessages}
                          previewMessages={item.sliceMessages}
                          isOpen={expandedKey === `bundle:${group.label}|${item.category}`}
                          onToggle={toggleKey}
                          expandedRef={expandedRef}
                          {...actions}
                        />
                      ),
                    )}
                  </div>
                </LayoutGroup>
              </section>
            ))}

            {all.length === 0 && <p className="text-neutral-500 text-sm">No messages found.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── BundleSliceRow ────────────────────────────────────────────────────────

function BundleSliceRow({
  bundleKey,
  category,
  allMessages,
  previewMessages,
  isOpen,
  onToggle,
  expandedRef,
  onPin,
  onDone,
  onSnooze,
}: {
  bundleKey: string;
  category: Category;
  allMessages: RawMessage[];      // all messages in this category (shown when expanded)
  previewMessages: RawMessage[];  // just this date-slice (shown in collapsed preview)
  isOpen: boolean;
  onToggle: (key: string) => void;
  expandedRef: React.RefObject<HTMLDivElement | null>;
} & Actions) {
  const meta = CATEGORIES[category];
  const unread = allMessages.filter((m) => !m.read).length;
  const preview = previewMessages.slice(0, 3).map((m) => senderName(m.author)).join(" · ");
  const [openMessageId, setOpenMessageId] = useState<number | null>(null);

  useEffect(() => { if (!isOpen) setOpenMessageId(null); }, [isOpen]);

  const toggleMsg = (id: number) =>
    setOpenMessageId((prev) => (prev === id ? null : id));

  const handleDoneAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    allMessages.forEach((m) => void onDone(m));
  };

  const flatGroups = buildFlatDateGroups(allMessages);

  return (
    <motion.div
      layout
      data-row
      ref={isOpen ? expandedRef : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={isOpen
        ? "w-full my-4 bg-neutral-200 rounded-xl overflow-hidden"
        : "w-full max-w-3xl mx-auto bg-white border-b border-neutral-100 last:border-b-0"}>
      {/* ── collapsed header ── */}
      {!isOpen && (
        <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50">
          <button
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
            onClick={() => onToggle(bundleKey)}
          >
            <span
              className="w-7 h-7 flex items-center justify-center rounded-full text-white text-base shrink-0"
              style={{ backgroundColor: meta.color }}
            >
              {meta.icon}
            </span>
            <span className="font-medium text-sm shrink-0" style={{ color: meta.color }}>
              {meta.name}
            </span>
            {unread > 0 && (
              <span className="text-xs font-semibold text-neutral-900 shrink-0">({unread})</span>
            )}
            <span className="text-sm text-neutral-400 truncate min-w-0">{preview}</span>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDoneAll}
              className="text-xs text-neutral-400 hover:text-neutral-700 px-1.5 py-0.5 rounded hover:bg-neutral-100"
            >
              Done all ✓
            </button>
            <button onClick={() => onToggle(bundleKey)} className="text-neutral-400 text-xs">▸</button>
          </div>
        </div>
      )}

      {/* ── expanded header ── */}
      {isOpen && (
        <div className="flex items-center justify-between px-5 py-4 bg-neutral-200">
          <button
            onClick={() => onToggle(bundleKey)}
            className="text-2xl font-bold hover:opacity-80"
            style={{ color: meta.color }}
          >
            {meta.name}
          </button>
          <div className="flex items-center gap-3 text-neutral-500">
            <button
              onClick={handleDoneAll}
              title="Archive all"
              className="text-sm hover:text-neutral-900 px-2 py-0.5 rounded hover:bg-neutral-100"
            >
              Done all ✓
            </button>
            <button
              onClick={() => onToggle(bundleKey)}
              className="text-neutral-400 hover:text-neutral-700"
              title="Collapse"
            >
              ▾
            </button>
          </div>
        </div>
      )}

      {/* ── expanded body ── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="bg-neutral-200 px-5 pb-5">
              {flatGroups.map(({ label, messages }) => (
                <div key={label}>
                  <p className="text-sm text-neutral-500 pt-4 pb-2 px-1">{label}</p>
                  <div className="flex flex-col gap-2">
                    {messages.map((m) => (
                      <BundleMessageCard
                        key={m.id}
                        message={m}
                        accentColor={meta.color}
                        isOpen={openMessageId === m.id}
                        onToggle={() => toggleMsg(m.id)}
                        onPin={onPin}
                        onDone={onDone}
                        onSnooze={onSnooze}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── BundleMessageCard ─────────────────────────────────────────────────────

function BundleMessageCard({
  message: m,
  accentColor,
  isOpen,
  onToggle,
  onPin,
  onDone,
  onSnooze,
}: {
  message: RawMessage;
  accentColor: string;
  isOpen: boolean;
  onToggle: () => void;
} & Actions) {
  const [hovered, setHovered] = useState(false);
  const name = senderName(m.author);
  const color = avatarColor(name);
  const weight = m.read ? "text-neutral-500" : "font-semibold text-neutral-900";

  return (
    <div
      className="bg-white rounded-lg shadow-sm overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="relative flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-50"
        onClick={onToggle}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {senderInitial(m.author)}
        </div>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className={`text-sm shrink-0 ${weight}`}>{name}</span>
          <span className="text-sm text-neutral-400 truncate">
            — {m.subject || "(no subject)"}
          </span>
          <span className="text-xs text-neutral-400 shrink-0 ml-auto">{formatDate(m.date)}</span>
        </div>
        {hovered && (
          <ActionStrip message={m} onPin={onPin} onDone={onDone} onSnooze={onSnooze} />
        )}
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="overflow-hidden border-t border-neutral-100"
          >
            <MessageBody message={m} accentColor={accentColor} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── MessageRow (main stream) ──────────────────────────────────────────────

function MessageRow({
  message: m,
  isExpanded,
  onToggleExpand,
  expandedRef,
  onPin,
  onDone,
  onSnooze,
}: {
  message: RawMessage;
  isExpanded: boolean;
  onToggleExpand: () => void;
  expandedRef: React.RefObject<HTMLDivElement | null>;
} & Actions) {
  const [hovered, setHovered] = useState(false);
  const weight = m.read ? "" : " font-semibold";

  return (
    <motion.div
      layout
      data-row
      ref={isExpanded ? expandedRef : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={isExpanded
        ? "w-full my-4 bg-white rounded-xl shadow-lg overflow-hidden"
        : "w-full max-w-3xl mx-auto bg-white border-b border-neutral-100 last:border-b-0"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="relative py-2 px-3 flex gap-3 items-baseline text-sm cursor-pointer hover:bg-neutral-50"
        onClick={onToggleExpand}
      >
        <span className="text-xs text-neutral-400 w-20 shrink-0">{formatDate(m.date)}</span>
        <span className={"w-48 truncate shrink-0" + weight}>{m.author}</span>
        <span className={"truncate" + weight}>{m.subject || "(no subject)"}</span>
        {hovered && <ActionStrip message={m} onPin={onPin} onDone={onDone} onSnooze={onSnooze} />}
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <MessageBody message={m} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── MessageBody ───────────────────────────────────────────────────────────

function MessageBody({ message: m, accentColor }: { message: RawMessage; accentColor?: string }) {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [isPlainText, setIsPlainText] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(200);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    messenger.messages.getFull(m.id).then((part) => {
      const html = extractHtmlBody(part);
      if (html) { setRawHtml(html); setIsPlainText(false); }
      else { setRawHtml(extractTextBody(part) ?? ""); setIsPlainText(true); }
    });
  }, [m.id]);

  useEffect(() => () => roRef.current?.disconnect(), []);

  const measureHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    roRef.current?.disconnect();
    const measure = () => setIframeHeight(doc.documentElement.scrollHeight + 24);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(doc.documentElement);
    roRef.current = ro;
  }, []);

  const srcdoc = useMemo(
    () => rawHtml !== null ? buildSrcdoc(rawHtml, showImages || isPlainText) : "",
    [rawHtml, showImages, isPlainText],
  );

  return (
    <div className={accentColor ? "bg-neutral-50 border-l-4" : "bg-neutral-50"}
      style={accentColor ? { borderLeftColor: accentColor } : {}}>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-neutral-200 text-xs text-neutral-500">
        <span>{m.author} &mdash; {new Date(m.date).toLocaleString()}</span>
        <div className="flex gap-2">
          {!showImages && !isPlainText && (
            <button onClick={() => setShowImages(true)}
              className="px-2 py-0.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700">
              Load images
            </button>
          )}
          <button
            onClick={() => void messenger.messageDisplay.open({ messageId: m.id, location: "tab" })}
            className="px-2 py-0.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700">
            Open in Thunderbird ↗
          </button>
        </div>
      </div>
      {rawHtml === null ? (
        <div className="px-4 py-6 text-sm text-neutral-400">Loading…</div>
      ) : (
        <iframe ref={iframeRef} sandbox="allow-same-origin" srcdoc={srcdoc} onLoad={measureHeight}
          style={{ width: "100%", height: iframeHeight, border: "none", display: "block" }}
          title={m.subject} />
      )}
    </div>
  );
}

// ─── ActionStrip ───────────────────────────────────────────────────────────

function ActionStrip({ message: m, onPin, onDone, onSnooze }: { message: RawMessage } & Actions) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snoozeOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSnoozeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [snoozeOpen]);

  return (
    <div ref={ref}
      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-white shadow rounded px-1 py-0.5"
      onClick={(e) => e.stopPropagation()}>
      <ActionBtn title={m.pinned ? "Unpin" : "Pin"} onClick={() => onPin(m)}>
        {m.pinned ? "📌" : "📍"}
      </ActionBtn>
      <div className="relative">
        <ActionBtn title="Snooze" onClick={() => setSnoozeOpen((o) => !o)}>🕐</ActionBtn>
        {snoozeOpen && (
          <div className="absolute right-0 top-full mt-1 z-10 bg-white shadow-lg rounded border border-neutral-200 py-1 min-w-36">
            {snoozePresets().map(({ label, wakeAt }) => (
              <button key={label}
                className="w-full text-left text-sm px-3 py-1.5 hover:bg-neutral-50"
                onClick={() => { setSnoozeOpen(false); onSnooze(m, wakeAt); }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ActionBtn title="Done (archive)" onClick={() => onDone(m)}>✓</ActionBtn>
    </div>
  );
}

function ActionBtn({ title, onClick, children }: {
  title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="p-1 rounded hover:bg-neutral-100 text-sm leading-none">
      {children}
    </button>
  );
}

// ─── SectionLabel ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 px-1">
      {children}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

function formatDate(epochMs: number): string {
  if (!epochMs) return "";
  const d = new Date(epochMs);
  const now = new Date();
  return isSameDay(d, now)
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
