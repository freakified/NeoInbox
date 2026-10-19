import { useMemo } from "react";
import { create } from "zustand";
import { db } from "./db";
import { deriveStream, type Stream, type StreamView } from "./stream";
import { composeSlice } from "./composeSlice";
import { getDefaultAccount } from "../spa/lib/accountPrefs";
import { loadHistoryPage, loadStartupMessages } from "./history";
import { mailSlice } from "./mailSlice";
import { connectPort } from "./portClient";
import { remindersSlice, startReminderWakeTimer } from "./remindersSlice";
import { applyServerMsg } from "./serverMsg";
import type {
  BundleSettingsRequest,
  ConnectionState,
  MailStore,
  SyncProgress,
  ToastRecord,
} from "./storeTypes";
import { toastsSlice } from "./toastsSlice";
import { tripsSlice } from "./tripsSlice";
import type {
  CustomBundleRecord,
  RawMessage,
  ReminderRecord,
  RouteRuleRecord,
  SnoozeRecord,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";

export type { Stream, StreamItem, StreamSection, StreamView } from "./stream";
export type {
  BundleSettingsRequest,
  ConnectionState,
  MailStore,
  NewMessagePrefill,
  PendingReply,
  ToastAction,
  ToastRecord,
} from "./storeTypes";

export const useMailStore = create<MailStore>((set, get) => ({
  messagesByKey: {},
  myEmails: new Set(),
  hydrated: false,
  syncProgress: null,
  inboxWindow: null,
  loadingMoreInbox: false,
  customBundles: [],
  routeRules: [],
  connectionState: "connected",
  pendingOps: {},
  snoozesByKey: {},
  remindersById: {},
  tripsById: {},
  tripMembershipByKey: {},
  toasts: [],
  pendingReplies: [],
  newMessageRequest: null,
  poppedReply: null,
  bundleSettings: null,
  reclassifying: false,
  tripScan: null,
  archiveImport: null,
  historyFrom: 0,
  loadingHistory: false,
  // Opens on the default account; switching is for this session only.
  accountFilter: getDefaultAccount(),

  setAccountFilter: (accountId) => set({ accountFilter: accountId }),

  init: async () => {
    if (get().hydrated) return;
    const [rawBundles, routeRules, snoozes, reminders, trips, tripMemberships] =
      await Promise.all([
        db.customBundles.toArray(),
        db.routeRules.toArray(),
        db.snoozes.toArray(),
        db.reminders.toArray(),
        db.trips.toArray(),
        db.tripMemberships.toArray(),
      ]);
    const { rows, historyFrom } = await loadStartupMessages(tripMemberships);
    const customBundles = rawBundles.sort((a, b) => a.order - b.order);
    const messagesByKey: Record<string, RawMessage> = {};
    for (const m of rows) messagesByKey[m.key] = m;
    const snoozesByKey: Record<string, SnoozeRecord> = {};
    for (const snooze of snoozes) snoozesByKey[snooze.messageKey] = snooze;
    const remindersById: Record<string, ReminderRecord> = {};
    for (const reminder of reminders) remindersById[reminder.id] = reminder;
    const tripsById: Record<string, TripRecord> = {};
    for (const trip of trips) tripsById[trip.id] = trip;
    const tripMembershipByKey: Record<string, TripMembershipRecord> = {};
    for (const membership of tripMemberships) tripMembershipByKey[membership.key] = membership;
    set({
      messagesByKey,
      historyFrom,
      hydrated: true,
      customBundles,
      routeRules,
      snoozesByKey,
      remindersById,
      tripsById,
      tripMembershipByKey,
    });

    startReminderWakeTimer(get);

    connectPort({
      onMessage: (msg) => applyServerMsg(set, get, msg),
      onConnected: () => set({ connectionState: "connected" }),
      // A reclassify in flight died with the port; unstick the button.
      onDisconnected: () => set({ connectionState: "reconnecting", reclassifying: false }),
    });
  },

  loadOlderHistory: async () => {
    const from = get().historyFrom;
    if (!from || get().loadingHistory) return;
    set({ loadingHistory: true });
    try {
      const { rows, historyFrom } = await loadHistoryPage(from);
      // Rows already in memory are newer than Dexie's copy or the same.
      const map = { ...get().messagesByKey };
      for (const m of rows) map[m.key] ??= m;
      set({ messagesByKey: map, historyFrom });
    } finally {
      set({ loadingHistory: false });
    }
  },

  reloadHistory: async () => {
    const { rows, historyFrom } = await loadHistoryPage();
    // Keep the "everything from historyFrom on is loaded" promise: the fresh
    // page only vouches for its own span, which may now end later than what
    // was loaded before (an import adds rows inside the old span too).
    const current = get().historyFrom;
    const map = { ...get().messagesByKey };
    for (const m of rows) map[m.key] ??= m;
    set({ messagesByKey: map, historyFrom: historyFrom === 0 ? 0 : Math.max(current, historyFrom) });
  },

  ...mailSlice(set, get),
  ...remindersSlice(set, get),
  ...tripsSlice(set, get),
  ...toastsSlice(set, get),
  ...composeSlice(set, get),
}));

// ─── selectors ──────────────────────────────────────────────────────────────

export const useStream = (): Stream => {
  const messagesByKey = useMailStore((s) => s.messagesByKey);
  const myEmails = useMailStore((s) => s.myEmails);
  return useMemo(
    () => deriveStream(messagesByKey, myEmails),
    [messagesByKey, myEmails],
  );
}

export const useStreamForView = (view: StreamView, pinnedOnly = false): Stream => {
  const messagesByKey = useMailStore((s) => s.messagesByKey);
  const myEmails = useMailStore((s) => s.myEmails);
  const snoozesByKey = useMailStore((s) => s.snoozesByKey);
  const remindersById = useMailStore((s) => s.remindersById);
  const tripsById = useMailStore((s) => s.tripsById);
  const tripMembershipByKey = useMailStore((s) => s.tripMembershipByKey);
  const accountFilter = useMailStore((s) => s.accountFilter);
  return useMemo(
    () =>
      deriveStream(
        messagesByKey,
        myEmails,
        view,
        snoozesByKey,
        pinnedOnly,
        remindersById,
        tripsById,
        tripMembershipByKey,
        accountFilter,
      ),
    [
      messagesByKey,
      myEmails,
      view,
      snoozesByKey,
      pinnedOnly,
      remindersById,
      tripsById,
      tripMembershipByKey,
      accountFilter,
    ],
  );
}

export const useHydrated = (): boolean => {
  return useMailStore((s) => s.hydrated);
}

export const useSyncProgress = (): SyncProgress | null => {
  return useMailStore((s) => s.syncProgress);
}

export const useConnectionState = (): ConnectionState => {
  return useMailStore((s) => s.connectionState);
}

export const useCustomBundles = (): CustomBundleRecord[] => {
  return useMailStore((s) => s.customBundles);
}

export const useRouteRules = (): RouteRuleRecord[] => {
  return useMailStore((s) => s.routeRules);
}

export const useToasts = (): ToastRecord[] => {
  return useMailStore((s) => s.toasts);
}

export const useBundleSettings = (): BundleSettingsRequest | null => {
  return useMailStore((s) => s.bundleSettings);
}

export const useTrips = (): Record<string, TripRecord> => {
  return useMailStore((s) => s.tripsById);
}

export const useTripMemberships = (): Record<string, TripMembershipRecord> => {
  return useMailStore((s) => s.tripMembershipByKey);
}
