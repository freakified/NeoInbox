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
  /** Whole thread archived: its check shows green and undoes the done. */
  isDone: boolean;
  /** Snoozed: its clock shows orange and unsnoozes. */
  isSnoozed: boolean;
  /** When the snooze wakes (the earliest, if its messages differ). */
  snoozeWakeAt?: number;
  togglePin: () => void;
  done: () => void;
  snooze: (wakeAt: number) => void;
  /** Keyboard's `s`: the menu's default landing spot, tomorrow at 8 AM. */
  snoozeDefault: () => void;
  unsnooze: () => void;
  trash: () => void;
  /** Holds received mail, which is all reportSpam acts on. */
  canReportSpam: boolean;
  /** Received mail only: your own replies in the thread aren't spam. */
  reportSpam: () => void;
  moveToInbox: () => void;
}

export const useThreadActions = (thread: Thread): ThreadActions => {
  const pin = useMailStore((st) => st.pin);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const unsnoozeThread = useMailStore((st) => st.unsnoozeThread);
  const notify = useMailStore((st) => st.notify);
  const moveToInboxThread = useMailStore((st) => st.moveToInboxThread);
  const snoozesByKey = useMailStore((st) => st.snoozesByKey);
  const { doneMessages, trashMessages, spamMessages } = useBulkActions();

  return useMemo(() => {
    const inboxMessageKeys = thread.messages
      .filter((m) => m.origin === "inbox")
      .map((m) => m.key);
    const doneMessageKeys = thread.messages
      .filter((m) => m.origin === "done")
      .map((m) => m.key);
    const snoozedMessageKeys = thread.messages.filter((m) => m.snoozed).map((m) => m.key);
    const snoozeWakeAt = snoozedMessageKeys
      .map((key) => snoozesByKey[key]?.wakeAt)
      .filter((wakeAt): wakeAt is number => typeof wakeAt === "number")
      .sort((a, b) => a - b)[0];

    const snooze = (wakeAt: number) => {
      snoozeThread(inboxMessageKeys, wakeAt);
      notify(`Snoozed until ${formatSnoozeToastTime(wakeAt)}`);
    };

    return {
      hasInboxMessages: inboxMessageKeys.length > 0,
      hasDoneMessages: doneMessageKeys.length > 0,
      hasSnoozedMessages: snoozedMessageKeys.length > 0,
      isDone: inboxMessageKeys.length === 0 && doneMessageKeys.length > 0,
      isSnoozed: snoozedMessageKeys.length > 0,
      snoozeWakeAt,
      togglePin: () => {
        const next = !thread.pinned;
        for (const m of thread.messages) pin(m.key, next);
      },
      done: () => doneMessages(inboxMessageKeys),
      snooze,
      snoozeDefault: () => {
        const presets = snoozePresets();
        const tomorrow = presets.find((preset) => preset.label === "Tomorrow") ?? presets[0];
        if (tomorrow) snooze(tomorrow.wakeAt);
      },
      unsnooze: () => {
        unsnoozeThread(snoozedMessageKeys);
        notify("Moved back to inbox");
      },
      trash: () => trashMessages(thread.messages.map((m) => m.key)),
      canReportSpam: inboxMessageKeys.length + doneMessageKeys.length > 0,
      reportSpam: () => spamMessages([...inboxMessageKeys, ...doneMessageKeys]),
      moveToInbox: () => {
        moveToInboxThread(doneMessageKeys);
        notify("Moved back to inbox");
      },
    };
  }, [
    doneMessages,
    moveToInboxThread,
    notify,
    pin,
    snoozeThread,
    snoozesByKey,
    spamMessages,
    thread,
    trashMessages,
    unsnoozeThread,
  ]);
};
