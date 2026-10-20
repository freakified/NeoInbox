import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageKey } from "../../shared/messageKey";
import { useMailStore } from "../../store/mailStore";
import s from "./BulkActionConfirm.module.css";

const CONFIRM_THRESHOLD = 25;

type BulkActionKind = "done" | "trash" | "spam";

interface PendingBulkAction {
  kind: BulkActionKind;
  messageKeys: MessageKey[];
}

interface BulkActionContextValue {
  doneMessages: (messageKeys: MessageKey[]) => void;
  trashMessages: (messageKeys: MessageKey[]) => void;
  spamMessages: (messageKeys: MessageKey[]) => void;
}

const BulkActionContext = createContext<BulkActionContextValue | null>(null);

const ACTION_TEXT: Record<BulkActionKind, string> = {
  done: "marked as done",
  trash: "moved to trash",
  spam: "reported as spam",
};

const DIALOG_TITLE: Record<BulkActionKind, string> = {
  done: "Mark messages as done?",
  trash: "Move messages to trash?",
  spam: "Report messages as spam?",
};

const dialogMessage = ({ kind, messageKeys }: PendingBulkAction): string =>
  `${messageKeys.length} messages will be ${ACTION_TEXT[kind]}.`;

export const BulkActionProvider = ({ children }: { children: React.ReactNode }) => {
  const doneThread = useMailStore((st) => st.doneThread);
  const trashThread = useMailStore((st) => st.trashThread);
  const spamThread = useMailStore((st) => st.spamThread);
  const [pending, setPending] = useState<PendingBulkAction | null>(null);

  const runAction = useCallback(
    ({ kind, messageKeys }: PendingBulkAction) => {
      if (kind === "done") doneThread(messageKeys);
      else if (kind === "spam") spamThread(messageKeys);
      else trashThread(messageKeys);
    },
    [doneThread, spamThread, trashThread],
  );

  const requestAction = useCallback(
    (kind: BulkActionKind, messageKeys: MessageKey[]) => {
      if (messageKeys.length === 0) return;
      const action = { kind, messageKeys };
      if (messageKeys.length >= CONFIRM_THRESHOLD) setPending(action);
      else runAction(action);
    },
    [runAction],
  );

  const value = useMemo<BulkActionContextValue>(
    () => ({
      doneMessages: (messageKeys) => requestAction("done", messageKeys),
      trashMessages: (messageKeys) => requestAction("trash", messageKeys),
      spamMessages: (messageKeys) => requestAction("spam", messageKeys),
    }),
    [requestAction],
  );

  const cancel = () => setPending(null);
  const confirm = () => {
    if (pending) runAction(pending);
    setPending(null);
  };

  return (
    <BulkActionContext.Provider value={value}>
      {children}
      {pending && createPortal(
        <div
          className={s.overlay}
          onClick={cancel}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        >
          <div
            className={s.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-action-confirm-title"
            aria-describedby="bulk-action-confirm-message"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="bulk-action-confirm-title" className={s.title}>
              {DIALOG_TITLE[pending.kind]}
            </h2>
            <p id="bulk-action-confirm-message" className={s.message}>
              {dialogMessage(pending)}
            </p>
            <div className={s.actions}>
              <button type="button" className={s.cancelBtn} onClick={cancel}>
                Cancel
              </button>
              <button type="button" className={s.okBtn} onClick={confirm} autoFocus>
                OK
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </BulkActionContext.Provider>
  );
};

export const useBulkActions = (): BulkActionContextValue => {
  const value = useContext(BulkActionContext);
  if (!value) throw new Error("useBulkActions must be used inside BulkActionProvider");
  return value;
};
