import { send } from "./portClient";
import type { MailStore, PendingReply, StoreGet, StoreSet, ToastRecord } from "./storeTypes";
import { nextToastId, TOAST_LIMIT } from "./toastsSlice";

let composeSeq = 0;
/** In-flight compose commands → the "Sending…" toast to replace when they end. */
export const pendingCompose = new Map<string, string | null>();

/**
 * How long a sent reply waits for its Sent copy before it's dropped anyway —
 * an account that keeps no Sent folder (or one we don't sync) never brings it.
 */
export const PENDING_REPLY_TIMEOUT_MS = 60_000;
export const pendingReplyTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const composeSlice = (
  set: StoreSet,
  get: StoreGet,
): Pick<
  MailStore,
  | "startNewMessage"
  | "clearNewMessageRequest"
  | "composeMessage"
  | "settlePendingReply"
  | "popOutReply"
  | "clearPoppedReply"
> => ({
  startNewMessage: (prefill) => set({ newMessageRequest: { ...prefill, key: Date.now() } }),
  clearNewMessageRequest: () => set({ newMessageRequest: null }),
  popOutReply: (reply) => set({ poppedReply: { ...reply, key: Date.now() } }),
  clearPoppedReply: () => set({ poppedReply: null }),
  composeMessage: (draft, sendNow, pending) => {
    const requestId = `c${++composeSeq}-${Date.now()}`;
    let toastId: string | null = null;
    if (sendNow) {
      const toast: ToastRecord = { id: nextToastId(), message: "Sending…" };
      toastId = toast.id;
      set({ toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
      if (pending) {
        const reply: PendingReply = { ...pending, requestId, date: Date.now(), status: "sending" };
        set({ pendingReplies: [...get().pendingReplies, reply] });
      }
    }
    pendingCompose.set(requestId, toastId);
    send({ type: "compose", requestId, draft, send: sendNow });
  },
  settlePendingReply: (requestId) => {
    const timer = pendingReplyTimers.get(requestId);
    if (timer !== undefined) clearTimeout(timer);
    pendingReplyTimers.delete(requestId);
    const rest = get().pendingReplies.filter((r) => r.requestId !== requestId);
    if (rest.length !== get().pendingReplies.length) set({ pendingReplies: rest });
  },
});
