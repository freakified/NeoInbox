import { useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { useMailStore } from "../../store/mailStore";
import type { PoppedReply } from "../../store/storeTypes";
import {
  composerBody,
  ComposerForm,
  emptyComposerValue,
  isComposerEmpty,
  type ComposerValue,
} from "./ComposerForm";
import { Icon } from "./Icon";
import s from "./ComposePanel.module.css";

/**
 * A new message closed without sending, reopened the next time Compose is
 * picked from the FAB. Lives for the tab's lifetime.
 */
let unsentNewMessage: ComposerValue | null = null;

/** Holds the open panels side by side, the first rightmost. */
export const ComposeDock = ({ children }: { children: ReactNode }) => (
  <div className={s.dock}>{children}</div>
);

/**
 * The floating Inbox-style compose card: a new message from the FAB, or a
 * reply popped out of its thread (`reply`).
 */
export const ComposePanel = ({
  to,
  prefill,
  reply,
  onClose,
  onReopen,
}: {
  /** Prefilled recipients (a FAB contact); otherwise any unsent message comes back. */
  to?: string[];
  /** Subject and body to start from (e.g. a forwarded trip itinerary). */
  prefill?: { subject: string; text: string; html: string };
  /** A popped-out reply; its thread decides how it's sent, kept or discarded. */
  reply?: PoppedReply;
  onClose: () => void;
  /** Opens the panel again (with the unsent message); used by discard's Undo. */
  onReopen?: () => void;
}) => {
  const composeMessage = useMailStore((st) => st.composeMessage);
  const notify = useMailStore((st) => st.notify);
  // A new message sends from the account being looked at.
  const accountFilter = useMailStore((st) => st.accountFilter);
  const [value, setValue] = useState<ComposerValue>(() =>
    reply
      ? reply.value
      : prefill
        ? { ...emptyComposerValue(), ...prefill }
        : to
          ? { ...emptyComposerValue(), to }
          : (unsentNewMessage ?? emptyComposerValue()),
  );

  // Decided once on open: following value.to would yank the cursor to the
  // body the moment the first recipient is committed (e.g. tabbing out of To).
  const [initialFocus] = useState<"to" | "text">(() => (value.to.length ? "text" : "to"));

  /** Folded down to its title bar, out of the way but still open. */
  const [minimized, setMinimized] = useState(false);

  // A reply replaced by another popped-out one goes back to its thread, not away.
  const latest = useRef(value);
  latest.current = value;
  const settled = useRef(false);
  useEffect(
    () => () => {
      if (reply && !settled.current) reply.keep(latest.current);
    },
    [],
  );

  const submit = (send: boolean, identityId: string | undefined) => {
    settled.current = true;
    if (reply) {
      reply.submit(value, send, identityId);
      onClose();
      return;
    }
    composeMessage(
      {
        kind: "new",
        identityId,
        to: value.to,
        cc: value.cc,
        subject: value.subject,
        ...composerBody(value),
      },
      send,
    );
    unsentNewMessage = null;
    onClose();
  };

  const close = () => {
    settled.current = true;
    if (reply) reply.keep(value);
    else unsentNewMessage = isComposerEmpty(value) ? null : value;
    onClose();
  };

  return (
    <div
      className={clsx(s.panel, minimized && s.minimized)}
      role="dialog"
      aria-label={reply ? "Reply" : "New message"}
    >
      <div
        className={s.titleBar}
        onClick={() => minimized && setMinimized(false)}
        title={minimized ? "Restore" : undefined}
      >
        <Icon name={reply ? "reply" : "drafts"} className={s.titleIcon} />
        {/* Like Inbox, the open card's bar is just the envelope until there's a subject. */}
        <span className={s.title}>
          {reply?.title || value.subject.trim() || (minimized ? "New message" : "")}
        </span>
        <button
          type="button"
          className={s.closeBtn}
          onClick={(e) => {
            e.stopPropagation();
            setMinimized((m) => !m);
          }}
          title={minimized ? "Restore" : "Minimize"}
        >
          <Icon name={minimized ? "expand_less" : "minimize"} className={s.closeIcon} />
        </button>
        <button
          type="button"
          className={s.closeBtn}
          onClick={(e) => {
            e.stopPropagation();
            submit(false, value.identityId);
          }}
          title="Pop out to Thunderbird (attachments, more formatting)"
          aria-label="Pop out to Thunderbird"
        >
          <Icon name="open_in_new" className={s.closeIcon} />
        </button>
        <button
          type="button"
          className={s.closeBtn}
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          title="Close (keeps your message)"
        >
          <Icon name="close" className={s.closeIcon} />
        </button>
      </div>
      {/* Kept mounted while minimized, so the editor keeps its cursor and undo. */}
      <div className={s.body} hidden={minimized}>
        <ComposerForm
          value={value}
          onChange={setValue}
          showSubject={!reply}
          foldAddresses
          fill
          identityContext={reply?.identityContext ?? { accountId: accountFilter ?? undefined }}
          placeholder={reply?.placeholder ?? "Say something"}
          focus={initialFocus}
          onSubmit={submit}
          onDiscard={() => {
            settled.current = true;
            if (reply) {
              onClose();
              reply.discard(value);
              return;
            }
            const previous = value;
            unsentNewMessage = null;
            onClose();
            if (!isComposerEmpty(previous)) {
              notify("Message discarded", [
                {
                  label: "Undo",
                  run: () => {
                    unsentNewMessage = previous;
                    onReopen?.();
                  },
                },
              ]);
            }
          }}
          onCollapse={close}
        />
      </div>
    </div>
  );
};
