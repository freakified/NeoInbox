import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { replyRecipients, type ComposeKind } from "../../shared/compose";
import { resolveLiveMessageId } from "../../shared/liveMessage";
import type { RawMessage, Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { senderName } from "../lib/avatar";
import type { ComposeMode } from "../lib/composePrefs";
import {
  composerBody,
  ComposerForm,
  emptyComposerValue,
  isComposerEmpty,
  type ComposerValue,
} from "./ComposerForm";
import { Icon } from "./Icon";
import s from "./InlineReply.module.css";

type ReplyKind = Exclude<ComposeKind, "new">;

interface ReplyState {
  kind: ReplyKind;
  value: ComposerValue;
}

/**
 * Unsent replies by thread, so closing a conversation (or switching away and
 * back) doesn't throw away what was typed. Lives for the tab's lifetime.
 */
const unsentReplies = new Map<string, ReplyState>();

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
    const liveId = await resolveLiveMessageId(m);
    if (liveId === null) return undefined;
    const full = await messenger.messages.getFull(liveId);
    return full.headers?.["reply-to"]?.[0];
  } catch {
    return undefined;
  }
};

export const InlineReply = ({
  thread,
  replyTarget,
  draft,
  mode,
}: {
  thread: Thread;
  replyTarget: RawMessage;
  /** A Thunderbird draft already saved in this conversation. */
  draft?: RawMessage;
  mode: Exclude<ComposeMode, "thunderbird">;
}) => {
  const myEmails = useMailStore((st) => st.myEmails);
  const composeMessage = useMailStore((st) => st.composeMessage);
  const notify = useMailStore((st) => st.notify);
  const [state, setState] = useState<ReplyState | null>(
    () => unsentReplies.get(thread.id) ?? null,
  );
  const replyToRef = useRef<{ id: number; value: string | undefined } | null>(null);

  useEffect(() => {
    setState(unsentReplies.get(thread.id) ?? null);
  }, [thread.id]);

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
    const cached = replyToRef.current?.id === replyTarget.id ? replyToRef.current : null;
    const source = { ...replyTarget, replyTo: cached?.value };
    update({ kind, value: { ...value, ...replyRecipients(source, kind, myEmails) } });
    if (cached) return;
    const replyTo = await loadReplyTo(replyTarget);
    replyToRef.current = { id: replyTarget.id, value: replyTo };
    if (!replyTo) return;
    const latest = unsentReplies.get(thread.id);
    if (!latest || latest.kind !== kind) return;
    update({
      kind,
      value: { ...latest.value, ...replyRecipients({ ...replyTarget, replyTo }, kind, myEmails) },
    });
  };

  const submit = async (send: boolean, identityId: string | undefined) => {
    if (!state) return;
    const liveId = await resolveLiveMessageId(replyTarget);
    if (liveId === null) {
      notify("Couldn't find the original message in Thunderbird");
      return;
    }
    composeMessage(
      {
        kind: state.kind,
        messageId: liveId,
        identityId,
        to: state.value.to,
        cc: state.value.cc,
        ...composerBody(state.value),
      },
      send,
    );
    update(null);
  };

  const discard = () => {
    const previous = state;
    update(null);
    if (previous && !isComposerEmpty(previous.value)) {
      notify("Reply discarded", [{ label: "Undo", run: () => update(previous) }]);
    }
  };

  const collapse = () => {
    if (state && isComposerEmpty(state.value)) update(null);
    else setState(null);
  };

  if (!state) {
    const unsent = unsentReplies.get(thread.id);
    return (
      <div className={s.bar} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={s.fauxInput}
          onClick={() => (unsent ? setState(unsent) : void start("replyAll"))}
        >
          <Icon name="reply_all" className={s.fauxIcon} />
          {unsent ? "Continue your reply…" : `Reply to ${senderName(replyTarget.author)}…`}
        </button>
        <button
          type="button"
          className={s.iconBtn}
          title="Forward"
          onClick={() => void start("forward")}
        >
          <Icon name="forward" className={s.iconBtnIcon} />
        </button>
        {draft && (
          <button
            type="button"
            className={s.draftBtn}
            onClick={() => void messenger.compose.beginNew(draft.id)}
            title="Open the draft saved in Thunderbird"
          >
            <Icon name="edit" className={s.iconBtnIcon} />
            Resume draft
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={s.card}>
      <ComposerForm
        value={state.value}
        onChange={(value) => update({ ...state, value })}
        mode={mode}
        avatar
        compactAddresses
        leading={<KindMenu kind={state.kind} onChoose={(kind) => void start(kind)} />}
        focus={state.kind === "forward" ? "to" : "text"}
        placeholder={state.kind === "forward" ? "Add a note" : "Write your reply"}
        onSubmit={(send, identityId) => void submit(send, identityId)}
        identityContext={{
          accountId: replyTarget.accountId,
          addresses: [replyTarget.author, ...replyTarget.recipients, ...replyTarget.ccList],
        }}
        onDiscard={discard}
        onCollapse={collapse}
      />
    </div>
  );
};
