import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMailStore } from "../../store/mailStore";
import s from "./BulkActionConfirm.module.css";

const CONFIRM_THRESHOLD = 25;

type BulkActionKind = "done" | "trash";

interface PendingBulkAction {
  kind: BulkActionKind;
  messageIds: number[];
}

interface BulkActionContextValue {
  doneMessages: (messageIds: number[]) => void;
  trashMessages: (messageIds: number[]) => void;
}

const BulkActionContext = createContext<BulkActionContextValue | null>(null);

const actionText = (kind: BulkActionKind): string =>
  kind === "done" ? "marked as done" : "moved to trash";

const dialogTitle = (kind: BulkActionKind): string =>
  kind === "done" ? "Mark messages as done?" : "Move messages to trash?";

const dialogMessage = ({ kind, messageIds }: PendingBulkAction): string =>
  `${messageIds.length} messages will be ${actionText(kind)}.`;

export const BulkActionProvider = ({ children }: { children: React.ReactNode }) => {
  const doneThread = useMailStore((st) => st.doneThread);
  const trashThread = useMailStore((st) => st.trashThread);
  const [pending, setPending] = useState<PendingBulkAction | null>(null);

  const runAction = useCallback(
    ({ kind, messageIds }: PendingBulkAction) => {
      if (kind === "done") doneThread(messageIds);
      else trashThread(messageIds);
    },
    [doneThread, trashThread],
  );

  const requestAction = useCallback(
    (kind: BulkActionKind, messageIds: number[]) => {
      if (messageIds.length === 0) return;
      const action = { kind, messageIds };
      if (messageIds.length >= CONFIRM_THRESHOLD) setPending(action);
      else runAction(action);
    },
    [runAction],
  );

  const value = useMemo<BulkActionContextValue>(
    () => ({
      doneMessages: (messageIds) => requestAction("done", messageIds),
      trashMessages: (messageIds) => requestAction("trash", messageIds),
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
              {dialogTitle(pending.kind)}
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
