import { useState } from "react";
import { useMailStore } from "../../store/mailStore";
import type { ComposeMode } from "../lib/composePrefs";
import {
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
  mode,
  onClose,
  onReopen,
}: {
  /** Prefilled recipients (a FAB contact); otherwise any unsent message comes back. */
  to?: string[];
  mode: Exclude<ComposeMode, "thunderbird">;
  onClose: () => void;
  /** Opens the panel again (with the unsent message); used by discard's Undo. */
  onReopen: () => void;
}) => {
  const composeMessage = useMailStore((st) => st.composeMessage);
  const notify = useMailStore((st) => st.notify);
  const [value, setValue] = useState<ComposerValue>(() =>
    to ? { ...emptyComposerValue(), to } : (unsentNewMessage ?? emptyComposerValue()),
  );

  const close = () => {
    unsentNewMessage = isComposerEmpty(value) ? null : value;
    onClose();
  };

  return (
    <div className={s.panel} role="dialog" aria-label="New message">
      <div className={s.titleBar}>
        <span className={s.title}>{value.subject.trim() || "New message"}</span>
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
          focus={value.to.length ? "text" : "to"}
          onSubmit={(send, identityId) => {
            composeMessage(
              {
                kind: "new",
                identityId,
                to: value.to,
                cc: value.cc,
                subject: value.subject,
                text: value.text,
              },
              send,
            );
            unsentNewMessage = null;
            onClose();
          }}
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
