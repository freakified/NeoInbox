import { useMemo } from "react";
import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { useBulkActions } from "../components/BulkActionConfirm";
import { formatSnoozeToastTime, snoozePresets } from "./snoozePresets";

/**
 * The per-thread verbs, in one place so the hover action strip and the keyboard
 * shortcuts can never drift apart — a shortcut that skipped the bulk-action
 * confirmation or the toast would be a subtly different action wearing the same
 * name.
 */
export interface ThreadActions {
  hasInboxMessages: boolean;
  hasDoneMessages: boolean;
  hasSnoozedMessages: boolean;
  togglePin: () => void;
  done: () => void;
  snooze: (wakeAt: number) => void;
  /** Keyboard's `s`: the menu's default landing spot, tomorrow at 8 AM. */
  snoozeDefault: () => void;
  unsnooze: () => void;
  trash: () => void;
  moveToInbox: () => void;
}

export const useThreadActions = (thread: Thread): ThreadActions => {
  const pin = useMailStore((st) => st.pin);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const unsnoozeThread = useMailStore((st) => st.unsnoozeThread);
  const notify = useMailStore((st) => st.notify);
  const moveToInboxThread = useMailStore((st) => st.moveToInboxThread);
  const { doneMessages, trashMessages } = useBulkActions();

  return useMemo(() => {
    const inboxMessageIds = thread.messages
      .filter((m) => m.origin === "inbox")
      .map((m) => m.id);
    const doneMessageIds = thread.messages
      .filter((m) => m.origin === "done")
      .map((m) => m.id);
    const snoozedMessageIds = thread.messages.filter((m) => m.snoozed).map((m) => m.id);

    const snooze = (wakeAt: number) => {
      snoozeThread(inboxMessageIds, wakeAt);
      notify(`Snoozed until ${formatSnoozeToastTime(wakeAt)}`);
    };

    return {
      hasInboxMessages: inboxMessageIds.length > 0,
      hasDoneMessages: doneMessageIds.length > 0,
      hasSnoozedMessages: snoozedMessageIds.length > 0,
      togglePin: () => {
        const next = !thread.pinned;
        for (const m of thread.messages) pin(m.id, next);
      },
      done: () => doneMessages(inboxMessageIds),
      snooze,
      snoozeDefault: () => {
        const presets = snoozePresets();
        const tomorrow = presets.find((preset) => preset.label === "Tomorrow") ?? presets[0];
        if (tomorrow) snooze(tomorrow.wakeAt);
      },
      unsnooze: () => {
        unsnoozeThread(snoozedMessageIds);
        notify("Moved back to inbox");
      },
      trash: () => trashMessages(thread.messages.map((m) => m.id)),
      moveToInbox: () => {
        moveToInboxThread(doneMessageIds);
        notify("Moved back to inbox");
      },
    };
  }, [
    doneMessages,
    moveToInboxThread,
    notify,
    pin,
    snoozeThread,
    thread,
    trashMessages,
    unsnoozeThread,
  ]);
};
