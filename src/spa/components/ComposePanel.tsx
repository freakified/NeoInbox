import { useState } from "react";
import { useMailStore } from "../../store/mailStore";
import type { ComposeMode } from "../lib/composePrefs";
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

/** The floating Inbox-style new-message card the FAB opens. */
export const ComposePanel = ({
  to,
  prefill,
  mode,
  onClose,
  onReopen,
}: {
  /** Prefilled recipients (a FAB contact); otherwise any unsent message comes back. */
  to?: string[];
  /** Subject and body to start from (e.g. a forwarded trip itinerary). */
  prefill?: { subject: string; text: string; html: string };
  mode: Exclude<ComposeMode, "thunderbird">;
  onClose: () => void;
  /** Opens the panel again (with the unsent message); used by discard's Undo. */
  onReopen: () => void;
}) => {
  const composeMessage = useMailStore((st) => st.composeMessage);
  const notify = useMailStore((st) => st.notify);
  const [value, setValue] = useState<ComposerValue>(() =>
    prefill
      ? { ...emptyComposerValue(), ...prefill }
      : to
        ? { ...emptyComposerValue(), to }
        : (unsentNewMessage ?? emptyComposerValue()),
  );

  const submit = (send: boolean, identityId: string | undefined) => {
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
    unsentNewMessage = isComposerEmpty(value) ? null : value;
    onClose();
  };

  return (
    <div className={s.panel} role="dialog" aria-label="New message">
      <div className={s.titleBar}>
        <span className={s.title}>{value.subject.trim() || "New message"}</span>
        {mode === "send" && (
          <button
            type="button"
            className={s.closeBtn}
            onClick={() => submit(false, value.identityId)}
            title="Pop out to Thunderbird (attachments, more formatting)"
            aria-label="Pop out to Thunderbird"
          >
            <Icon name="open_in_new" className={s.closeIcon} />
          </button>
        )}
        <button type="button" className={s.closeBtn} onClick={close} title="Close (keeps your message)">
          <Icon name="close" className={s.closeIcon} />
        </button>
      </div>
      <div className={s.body}>
        <ComposerForm
          value={value}
          onChange={setValue}
          mode={mode}
          showSubject
          hidePopOut
          focus={value.to.length ? "text" : "to"}
          onSubmit={submit}
          onDiscard={() => {
            const previous = value;
            unsentNewMessage = null;
            onClose();
            if (!isComposerEmpty(previous)) {
              notify("Message discarded", [
                {
                  label: "Undo",
                  run: () => {
                    unsentNewMessage = previous;
                    onReopen();
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
