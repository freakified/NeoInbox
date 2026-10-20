import { flushDelta } from "./deltas";
import { send } from "./portClient";
import type { MailStore, StoreGet, StoreSet, ToastRecord } from "./storeTypes";
import { retireTrashedFromTrips } from "./tripsSlice";
import type { FailedCommand } from "../shared/messaging";

export const UNDO_TIMEOUT_MS = 5000;
export const TOAST_LIMIT = 3;

let toastSeq = 0;
export const nextToastId = (): string => `t${++toastSeq}-${Date.now()}`;

const messagesLabel = (count: number): string =>
  count === 1 ? "Message" : `${count} messages`;

export const doneToastMessage = (count: number): string =>
  `${messagesLabel(count)} marked as done`;

export const trashToastMessage = (count: number): string =>
  count === 1 ? "Moved to trash" : `${count} messages moved to trash`;

export const spamToastMessage = (count: number): string =>
  count === 1 ? "Reported as spam" : `${count} messages reported as spam`;

export const undoTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const commitUndoToast = (
  get: StoreGet,
  set: StoreSet,
  toastId: string,
): void => {
  const timer = undoTimers.get(toastId);
  if (timer !== undefined) {
    clearTimeout(timer);
    undoTimers.delete(toastId);
  }
  const toast = get().toasts.find((t) => t.id === toastId);
  if (toast?.undo) {
    for (const messageKey of toast.undo.messageKeys) {
      send({ type: toast.undo.kind, messageKey });
    }
    if (toast.undo.kind !== "done") retireTrashedFromTrips(get, set, toast.undo.messageKeys);
  }
  set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
};

export const failureLabel = (command: FailedCommand): string => {
  if (command === "done") return "Couldn't archive";
  if (command === "snooze") return "Couldn't snooze";
  if (command === "unsnooze") return "Couldn't unsnooze";
  if (command === "move-to-inbox") return "Couldn't move to inbox";
  if (command === "spam") return "Couldn't report spam";
  return "Couldn't move to trash";
}


export const toastsSlice = (
  set: StoreSet,
  get: StoreGet,
): Pick<
  MailStore,
  "retryToast" | "undoToast" | "dismissToast" | "notify"
> => ({
  retryToast: (toastId) => {
    const toast = get().toasts.find((t) => t.id === toastId);
    if (!toast?.retry) return;
    set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
    const { kind, messageKey, wakeAt } = toast.retry;
    if (kind === "done") get().doneThread([messageKey]);
    else if (kind === "trash") get().trashThread([messageKey]);
    else if (kind === "spam") get().spamThread([messageKey]);
    else if (kind === "unsnooze") get().unsnoozeThread([messageKey]);
    else if (kind === "move-to-inbox") get().moveToInboxThread([messageKey]);
    else if (kind === "snooze" && wakeAt !== undefined) {
      get().snoozeThread([messageKey], wakeAt);
    }
  },
  undoToast: (toastId) => {
    flushDelta(set, get);
    const timer = undoTimers.get(toastId);
    if (timer !== undefined) {
      clearTimeout(timer);
      undoTimers.delete(toastId);
    }
    const toast = get().toasts.find((t) => t.id === toastId);
    if (toast?.undo) {
      const pending = { ...get().pendingOps };
      const map = { ...get().messagesByKey };
      for (const key of toast.undo.messageKeys) {
        const op = pending[key];
        if (op) {
          map[key] = op.message;
          delete pending[key];
        }
      }
      set({ messagesByKey: map, pendingOps: pending });
    }
    set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
  },
  dismissToast: (toastId) => {
    const toast = get().toasts.find((t) => t.id === toastId);
    if (toast?.undo) {
      commitUndoToast(get, set, toastId);
    } else {
      set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
    }
  },
  notify: (message, actions) => {
    const toast: ToastRecord = { id: nextToastId(), message, actions };
    set({ toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
  },
});
