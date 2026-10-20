/**
 * Runs NeoInbox in an ordinary browser tab, no Thunderbird required: the fake
 * messenger stands in for `messenger.*`, the real background modules run in
 * the same page, and the real SPA renders on top. Served by `pnpm harness`
 * at /dev.html; never part of the extension build.
 *
 * Every load starts from a blank database and the seed mailbox, because the
 * fake's mail lives in memory and a kept database would drift from it. Pass
 * ?keep to skip the wipe anyway (useful for checking migrations or persisted
 * UI state, as long as you don't mind stale rows).
 *
 * ?demo swaps in the public demo's mailbox (demoSeed.ts), pins and reminders
 * included, in place of the dev seed's edge cases. The website's build
 * (`--mode site`) always runs it.
 *
 * Poke it from the console (or a Playwright script) through `window.neo`:
 *   await neo.deliver("promo")              // new mail lands, fires events
 *   await neo.deliver({ subject: "Hi", author: "Bo <bo@x.example>" })
 *   neo.mail.hang("getFull")                // simulate a stalled IMAP fetch
 *   neo.store().messagesByKey                // the SPA store's state
 *   neo.setStore({ tripsById: {...} })      // inject state directly
 *   neo.mail.calls.compose                  // compose windows "opened"
 *   neo.mail.calls.sent                     // inline drafts "sent" (final details)
 */
import { installFakeMessenger, settle, type FakeMessageSpec } from "../test/fakeMessenger";
import { forumMail, personalMail, promoMail } from "../test/fixtures";
import type { ArchiveJob } from "../background/archiveJob";
import { demoSeed } from "./demoSeed";
import { INBOX, seedMailbox } from "./seed";

const KINDS = { promo: promoMail, forum: forumMail, personal: personalMail } as const;
type Kind = keyof typeof KINDS;

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });

const start = async (): Promise<void> => {
  const params = new URLSearchParams(location.search);
  const fresh = !params.has("keep");
  if (fresh) await deleteDatabase("neoinbox");

  const demo = params.has("demo") || import.meta.env.MODE === "site" ? demoSeed() : null;
  const mail = installFakeMessenger(demo?.mailbox ?? seedMailbox());
  if (demo && fresh) {
    // Before the background loads: it caches pins on first read.
    const { db } = await import("../store/db");
    await db.pins.bulkPut(demo.pins);
    await db.reminders.bulkPut(demo.reminders);
    // The demo's archive is small, so load all of it the way Trips' "Load
    // older mail" would: left as an interrupted job, it resumes right after
    // the first backfill. Done gets its mail, past trips show, and the
    // footers offering older mail have nothing left to offer.
    const { JOB_KEY } = await import("../background/archiveJob");
    const job: ArchiveJob = { kind: "trips", importSince: null };
    mail.storageData[JOB_KEY] = job;
  }

  // index.ts wires the port server at import, so it has to be listening
  // before the SPA store connects. onInstalled kicks off the first backfill,
  // exactly as installing the extension does.
  await import("../background/index");
  void mail.runtimeApi.onInstalled.emit({ reason: params.has("keep") ? "update" : "install" });

  const { useMailStore } = await import("../store/mailStore");
  const { db } = await import("../store/db");

  const neo = {
    mail,
    db,
    settle,
    store: () => useMailStore.getState(),
    /** For seeding state the fake mailbox can't produce, e.g. years of trips. */
    setStore: useMailStore.setState,
    deliver: (what: Kind | FakeMessageSpec = "personal", folderId = INBOX): Promise<number> =>
      mail.deliver(folderId, typeof what === "string" ? KINDS[what]({ date: new Date() }) : { date: new Date(), ...what }),
  };
  (window as unknown as { neo: typeof neo }).neo = neo;

  if (demo && fresh) {
    // Let the archive job finish before the app mounts. The SPA then learns
    // of the finished scan through hello rather than watching it end, so the
    // "Older mail loaded" toast, which no demo visitor asked for, never shows.
    const { getLastArchiveScan } = await import("../background/extract");
    const giveUpAt = Date.now() + 10_000;
    while (!(await getLastArchiveScan()) && Date.now() < giveUpAt) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  await import("../spa/main");
};

void start();
