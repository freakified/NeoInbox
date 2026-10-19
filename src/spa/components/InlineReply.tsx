import type { MessageKey } from "../../shared/messageKey";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { pickIdentity, replyRecipients, type ComposeKind } from "../../shared/compose";
import { liveTbId } from "../../shared/liveMessage";
import type { RawMessage, Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { loadDraftValue } from "../lib/draftValue";
import { useIdentities } from "../lib/identities";
import {
  composerBody,
  ComposerForm,
  emptyComposerValue,
  isComposerEmpty,
  type ComposerValue,
} from "./ComposerForm";
import { Icon } from "./Icon";
import { SelfPhoto } from "./SelfPhoto";
import s from "./InlineReply.module.css";

type ReplyKind = Exclude<ComposeKind, "new" | "draft">;

type ReplyState =
  | { kind: ReplyKind; value: ComposerValue }
  /** Editing a draft saved in Thunderbird, which send or discard then replaces. */
  | { kind: "draft"; draftKey: MessageKey; value: ComposerValue };

/**
 * Unsent replies by thread, so closing a conversation (or switching away and
 * back) doesn't throw away what was typed. Lives for the tab's lifetime.
 */
const unsentReplies = new Map<string, ReplyState>();

/**
 * Drafts just sent from here. Thunderbird deletes them once the send lands;
 * until then they stay hidden instead of reappearing as a card.
 */
const sentDraftKeys = new Set<MessageKey>();

/** Whether the thread shows this draft as an editable card (see ThreadView). */
export const isEditableDraft = (draft: RawMessage | undefined): draft is RawMessage =>
  !!draft && !sentDraftKeys.has(draft.key);

const KINDS: { kind: ReplyKind; label: string; icon: string }[] = [
  { kind: "replyAll", label: "Reply all", icon: "reply_all" },
  { kind: "reply", label: "Reply", icon: "reply" },
  { kind: "forward", label: "Forward", icon: "forward" },
];

/** The Inbox-style switcher: the current kind's icon, opening a small menu. */
const KindMenu = ({
  kind,
  onChoose,
}: {
  kind: ReplyKind;
  onChoose: (kind: ReplyKind) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = KINDS.find((k) => k.kind === kind) ?? KINDS[0]!;

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ left: rect.left, top: rect.bottom + 4 });
    menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        triggerRef.current?.focus();
      } else if (
        menuRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={s.kindTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current.label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={current.icon} className={s.kindIcon} />
        <Icon name="arrow_drop_down" className={s.kindCaret} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={menuRef} role="menu" className={s.kindMenu} style={pos}>
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="menuitemradio"
                aria-checked={k.kind === kind}
                className={clsx(s.kindItem, k.kind === kind && s.kindItemActive)}
                onClick={() => {
                  setOpen(false);
                  if (k.kind !== kind) onChoose(k.kind);
                }}
              >
                <Icon name={k.icon} className={s.kindIcon} />
                {k.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

/** Reply-To lives only in the full headers, which the cached row doesn't keep. */
const loadReplyTo = async (m: RawMessage): Promise<string | undefined> => {
  try {
    const liveId = await liveTbId(m);
    if (liveId === null) return undefined;
    const full = await messenger.messages.getFull(liveId);
    return full.headers?.["reply-to"]?.[0];
  } catch {
    return undefined;
  }
};

/**
 * A saved draft, folded like a message in the thread: who it's to and what
 * it says so far. Clicking it opens it in the composer.
 */
const DraftCard = ({
  draft,
  edited,
  onOpen,
  onDiscard,
}: {
  draft: RawMessage;
  /** Unsent edits to the draft, shown instead of what Thunderbird saved. */
  edited?: ComposerValue;
  onOpen: () => void;
  onDiscard: () => void;
}) => {
  const [saved, setSaved] = useState<ComposerValue | null | undefined>(undefined);

  useEffect(() => {
    if (edited) return;
    let cancelled = false;
    setSaved(undefined);
    void loadDraftValue(draft).then((v) => {
      if (!cancelled) setSaved(v);
    });
    return () => {
      cancelled = true;
    };
  }, [draft, edited]);

  const value = edited ?? saved;
  const to = [...(value?.to ?? draft.recipients), ...(value?.cc ?? draft.ccList)]
    .map((raw) => senderName(raw) || raw)
    .join(", ");
  // Look like the composer it opens into, which shows the sending identity.
  const identity = useIdentities().find((i) => i.id === value?.identityId);
  const name = identity?.name || identity?.email || senderName(draft.author);
  const snippet =
    value === undefined ? "Loading draft…" : value?.text.replace(/\s+/g, " ").trim() || "(no text)";

  return (
    <div
      className={s.draftCard}
      role="button"
      tabIndex={0}
      title="Edit draft"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
    >
      <div className={s.draftAvatar} style={{ backgroundColor: avatarColor(name) }}>
        <SelfPhoto email={identity?.email}>{senderInitial(name)}</SelfPhoto>
      </div>
      <div className={s.draftMeta}>
        <div className={s.draftLine}>
          <span className={s.draftBadge}>Draft</span>
          {to && <span className={s.draftTo}>to {to}</span>}
          <span className={s.draftDate}>{formatDate(draft.date)}</span>
        </div>
        <div className={s.draftSnippet}>{snippet}</div>
      </div>
      <button
        type="button"
        className={s.iconBtn}
        title="Discard draft"
        onClick={(e) => {
          e.stopPropagation();
          onDiscard();
        }}
      >
        <Icon name="delete" className={s.iconBtnIcon} />
      </button>
    </div>
  );
};

export const InlineReply = ({
  thread,
  replyTarget,
  draft: savedDraft,
}: {
  thread: Thread;
  replyTarget: RawMessage;
  /** A Thunderbird draft already saved in this conversation. */
  draft?: RawMessage;
}) => {
  const myEmails = useMailStore((st) => st.myEmails);
  const composeMessage = useMailStore((st) => st.composeMessage);
  const trashThread = useMailStore((st) => st.trashThread);
  const notify = useMailStore((st) => st.notify);
  const popOutReply = useMailStore((st) => st.popOutReply);
  // While this thread's reply is out in the floating panel, the thread shows none.
  const poppedOut = useMailStore((st) => st.poppedReply?.threadId === thread.id);
  const draft = isEditableDraft(savedDraft) ? savedDraft : undefined;
  const identities = useIdentities();
  const identityContext = {
    accountId: replyTarget.accountId,
    addresses: [replyTarget.author, ...replyTarget.recipients, ...replyTarget.ccList],
  };
  // Who the reply would be from, for the avatar on the collapsed bar.
  const defaultIdentity = pickIdentity(identities, identityContext);
  const meName = defaultIdentity?.name || defaultIdentity?.email || "Me";

  /** What's kept for this thread, minus edits to a draft that has since gone. */
  const stored = (): ReplyState | null => {
    const st = unsentReplies.get(thread.id);
    if (st?.kind === "draft" && st.draftKey !== draft?.key) {
      unsentReplies.delete(thread.id);
      return null;
    }
    return st ?? null;
  };

  const [state, setState] = useState<ReplyState | null>(stored);
  const replyToRef = useRef<{ key: MessageKey; value: string | undefined } | null>(null);

  useEffect(() => {
    setState(stored());
  }, [thread.id, draft?.key]);

  const update = (next: ReplyState | null) => {
    if (next) unsentReplies.set(thread.id, next);
    else unsentReplies.delete(thread.id);
    setState(next);
  };

  const start = async (kind: ReplyKind) => {
    const value = unsentReplies.get(thread.id)?.value ?? emptyComposerValue();
    if (kind === "forward") {
      update({ kind, value: { ...value, to: [], cc: [] } });
      return;
    }
    // Show the composer right away; Reply-To (when there is one) lands a beat later.
    const cached = replyToRef.current?.key === replyTarget.key ? replyToRef.current : null;
    const source = { ...replyTarget, replyTo: cached?.value };
    update({ kind, value: { ...value, ...replyRecipients(source, kind, myEmails) } });
    if (cached) return;
    const replyTo = await loadReplyTo(replyTarget);
    replyToRef.current = { key: replyTarget.key, value: replyTo };
    if (!replyTo) return;
    const latest = unsentReplies.get(thread.id);
    if (!latest || latest.kind !== kind) return;
    update({
      kind,
      value: { ...latest.value, ...replyRecipients({ ...replyTarget, replyTo }, kind, myEmails) },
    });
  };

  const openDraft = async () => {
    if (!draft) return;
    const kept = stored();
    if (kept?.kind === "draft") {
      setState(kept);
      return;
    }
    const value = await loadDraftValue(draft);
    if (!value) {
      notify("Couldn't open the draft");
      return;
    }
    update({ kind: "draft", draftKey: draft.key, value });
  };

  const submit = async (state: ReplyState, send: boolean, identityId: string | undefined) => {
    const target = state.kind === "draft" ? draft : replyTarget;
    // Checked here for a specific message; the background resolves it again.
    const liveId = target ? await liveTbId(target) : null;
    if (!target || liveId === null) {
      notify(
        state.kind === "draft"
          ? "Couldn't find the draft in Thunderbird"
          : "Couldn't find the original message in Thunderbird",
      );
      return;
    }
    const body = composerBody(state.value);
    const identity = identities.find((i) => i.id === identityId) ?? defaultIdentity;
    composeMessage(
      {
        kind: state.kind,
        messageKey: target.key,
        identityId,
        to: state.value.to,
        cc: state.value.cc,
        ...body,
      },
      send,
      // A forward may not thread back in here, so only replies show as pending.
      state.kind === "forward"
        ? undefined
        : {
            threadId: thread.id,
            knownKeys: thread.messages.map((m) => m.key),
            author: identity
              ? identity.name
                ? `${identity.name} <${identity.email}>`
                : identity.email
              : "Me",
            to: state.value.to,
            cc: state.value.cc,
            ...body,
          },
    );
    if (state.kind === "draft" && send) sentDraftKeys.add(state.draftKey);
    update(null);
  };

  /** Moves the saved draft to the trash, with the usual Undo. */
  const discardDraft = () => {
    if (!draft) return;
    update(null);
    trashThread([draft.key]);
  };

  /** Moves the reply into the floating panel, which hands it back on close. */
  const popOut = (st: ReplyState) => {
    const subject = (st.kind === "draft" ? draft?.subject : replyTarget.subject) ?? "";
    const prefix = st.kind === "forward" ? "Fwd: " : st.kind === "draft" ? "" : "Re: ";
    popOutReply({
      threadId: thread.id,
      title: /^(re|fwd?):/i.test(subject) ? subject : `${prefix}${subject}`,
      value: st.value,
      identityContext,
      placeholder: st.kind === "forward" ? "Add a note" : "Write your reply",
      submit: (value, send, identityId) => void submit({ ...st, value }, send, identityId),
      keep: (value) => {
        unsentReplies.set(thread.id, { ...st, value });
      },
      discard: (value) => {
        if (st.kind === "draft") {
          trashThread([st.draftKey]);
        } else if (!isComposerEmpty(value)) {
          notify("Reply discarded", [{ label: "Undo", run: () => popOut({ ...st, value }) }]);
        }
      },
    });
    unsentReplies.delete(thread.id);
    setState(null);
  };

  const discard = () => {
    if (state?.kind === "draft") {
      discardDraft();
      return;
    }
    const previous = state;
    update(null);
    if (previous && !isComposerEmpty(previous.value)) {
      notify("Reply discarded", [{ label: "Undo", run: () => update(previous) }]);
    }
  };

  const collapse = () => {
    // A draft stays put (it's saved in Thunderbird); an empty reply just goes.
    if (state && state.kind !== "draft" && isComposerEmpty(state.value)) update(null);
    else setState(null);
  };

  if (poppedOut) return null;

  if (!state) {
    const unsent = stored();
    // The bar starts a reply-all, which is a plain reply when it's one person.
    const all = replyRecipients(replyTarget, "replyAll", myEmails);
    const replyAllLabel = all.to.length + all.cc.length > 1 ? "Reply all" : "Reply";
    const unsentReply = unsent?.kind === "draft" ? null : unsent;
    return (
      <>
        {draft && (
          <DraftCard
            draft={draft}
            edited={unsent?.kind === "draft" ? unsent.value : undefined}
            onOpen={() => void openDraft()}
            onDiscard={discardDraft}
          />
        )}
        {(!draft || unsentReply) && (
          <div className={s.bar} onClick={(e) => e.stopPropagation()}>
            <div className={s.barAvatar} style={{ backgroundColor: avatarColor(meName) }}>
              <SelfPhoto email={defaultIdentity?.email}>{senderInitial(meName)}</SelfPhoto>
            </div>
            <button
              type="button"
              className={s.fauxInput}
              title={unsentReply ? undefined : `Reply to ${senderName(replyTarget.author)}`}
              onClick={() => (unsentReply ? setState(unsentReply) : void start("replyAll"))}
            >
              {unsentReply ? "Continue your reply…" : replyAllLabel}
            </button>
            <button
              type="button"
              className={s.iconBtn}
              title="Forward"
              onClick={() => void start("forward")}
            >
              <Icon name="forward" className={s.iconBtnIcon} />
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={s.card}>
      <ComposerForm
        value={state.value}
        onChange={(value) => update({ ...state, value })}
        avatar
        compactAddresses
        leading={
          state.kind === "draft" ? (
            <span className={s.draftBadge}>Draft</span>
          ) : (
            <KindMenu kind={state.kind} onChoose={(kind) => void start(kind)} />
          )
        }
        focus={state.kind === "forward" ? "to" : "text"}
        placeholder={state.kind === "forward" ? "Add a note" : "Write your reply"}
        onSubmit={(send, identityId) => void submit(state, send, identityId)}
        onPopOut={() => popOut(state)}
        identityContext={identityContext}
        onDiscard={discard}
        onCollapse={collapse}
      />
    </div>
  );
};
