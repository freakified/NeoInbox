/**
 * Boots a clean NeoInbox — fake Thunderbird, fresh database, real background
 * wiring, real SPA store — for one test.
 *
 * The background modules keep module-level state (the serialized scan chain,
 * the connected-port registry, in-flight sweep guards) and the store is a
 * singleton, so tests that share module instances leak into each other. Every
 * boot resets the module registry and reimports, which is the only way to get
 * each test the same blank slate a fresh Thunderbird start would give it.
 */
import { vi } from "vitest";
import { installFakeMessenger, type FakeMessenger, type FakeMessengerOptions } from "./fakeMessenger";

export interface Booted {
  mail: FakeMessenger;
  db: (typeof import("../store/db"))["db"];
  useMailStore: (typeof import("../store/mailStore"))["useMailStore"];
  store: () => ReturnType<(typeof import("../store/mailStore"))["useMailStore"]["getState"]>;
  deriveStream: (typeof import("../store/stream"))["deriveStream"];
  /** The scan, details and classifier-sweep modules, as one namespace. */
  backfill: typeof import("../background/backfill") &
    typeof import("../background/detailsFill") &
    typeof import("../background/classifierSweep") &
    typeof import("../background/scanQueue");
}

export interface BootOptions {
  /**
   * Wire the background's sync engine, port server and command handler.
   * Turn it off to test the SPA store against a silent far end, where every
   * ServerMsg is the test's own rather than a real reply.
   */
  wireBackground?: boolean;
}

export const boot = async (
  options: FakeMessengerOptions,
  { wireBackground = true }: BootOptions = {},
): Promise<Booted> => {
  vi.resetModules();
  const mail = installFakeMessenger(options);

  const { db } = await import("../store/db");
  await db.delete();
  await db.open();

  const { wireSyncEngine } = await import("../background/sync");
  const { onCommand, startPortServer } = await import("../background/port");
  const { handleCommand } = await import("../background/commands");
  const backfill = {
    ...(await import("../background/backfill")),
    ...(await import("../background/detailsFill")),
    ...(await import("../background/classifierSweep")),
    ...(await import("../background/scanQueue")),
  };
  const { useMailStore } = await import("../store/mailStore");
  const { deriveStream } = await import("../store/stream");

  // What index.ts wires up at load, minus the alarms and periodic sweeps.
  if (wireBackground) {
    wireSyncEngine();
    startPortServer();
    onCommand(handleCommand);
  }

  return {
    mail,
    db,
    useMailStore,
    store: () => useMailStore.getState(),
    deriveStream,
    backfill,
  };
};
