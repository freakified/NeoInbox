import { db } from "./db";
import type { MailStore, StoreGet, StoreSet } from "./storeTypes";
import { log } from "../shared/log";
import type { ReminderRecord } from "../shared/types";

/** Reminders are SPA-owned; they persist straight to Dexie, no port round-trip. */
const persistReminder = (record: ReminderRecord): void => {
  void db.reminders.put(record).catch((e) => log.warn("store", "reminder save failed", e));
};

let reminderWakeTimer: ReturnType<typeof setInterval> | null = null;

/** Resurface due reminders now, then every 30s while the tab is open. */
export const startReminderWakeTimer = (get: StoreGet): void => {
  get().wakeDueReminders();
  if (reminderWakeTimer === null) {
    reminderWakeTimer = setInterval(() => get().wakeDueReminders(), 30_000);
  }
};

export const remindersSlice = (
  set: StoreSet,
  get: StoreGet,
): Pick<
  MailStore,
  "createReminder" | "updateReminderText" | "setReminderPinned" | "snoozeReminder" | "unsnoozeReminder" | "doneReminder" | "restoreReminder" | "deleteReminder" | "wakeDueReminders"
> => ({
  createReminder: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const record: ReminderRecord = {
      id: crypto.randomUUID(),
      text: trimmed,
      createdAt: Date.now(),
      status: "active",
      pinned: false,
    };
    set({ remindersById: { ...get().remindersById, [record.id]: record } });
    persistReminder(record);
  },
  updateReminderText: (id, text) => {
    const prev = get().remindersById[id];
    const trimmed = text.trim();
    if (!prev || !trimmed || prev.text === trimmed) return;
    const next = { ...prev, text: trimmed };
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },
  setReminderPinned: (id, pinned) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next = { ...prev, pinned };
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },
  snoozeReminder: (id, wakeAt) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, snoozeWakeAt: wakeAt };
    delete next.resurfacedAt;
    delete next.snoozeExpired;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },
  unsnoozeReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, resurfacedAt: Date.now() };
    delete next.snoozeWakeAt;
    delete next.snoozeExpired;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },
  doneReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, status: "done", doneAt: Date.now() };
    delete next.snoozeWakeAt;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
    get().notify("Reminder marked as done", [
      {
        label: "Undo",
        run: () => {
          set({ remindersById: { ...get().remindersById, [id]: prev } });
          persistReminder(prev);
        },
      },
    ]);
  },
  restoreReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, status: "active", resurfacedAt: Date.now() };
    delete next.snoozeExpired;
    delete next.doneAt;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
    get().notify("Reminder moved back to inbox");
  },
  deleteReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const map = { ...get().remindersById };
    delete map[id];
    set({ remindersById: map });
    void db.reminders.delete(id).catch((e) => log.warn("store", "reminder delete failed", e));
    get().notify("Reminder deleted", [
      {
        label: "Undo",
        run: () => {
          set({ remindersById: { ...get().remindersById, [id]: prev } });
          persistReminder(prev);
        },
      },
    ]);
  },
  wakeDueReminders: () => {
    const now = Date.now();
    const map = get().remindersById;
    const due = Object.values(map).filter(
      (r) => r.snoozeWakeAt !== undefined && r.snoozeWakeAt <= now,
    );
    if (!due.length) return;
    const next = { ...map };
    for (const r of due) {
      const woken: ReminderRecord = { ...r, resurfacedAt: r.snoozeWakeAt, snoozeExpired: true };
      delete woken.snoozeWakeAt;
      next[r.id] = woken;
      persistReminder(woken);
    }
    set({ remindersById: next });
  },
});
