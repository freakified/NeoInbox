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
 * Poke it from the console (or a Playwright script) through `window.neo`:
 *   await neo.deliver("promo")              // new mail lands, fires events
 *   await neo.deliver({ subject: "Hi", author: "Bo <bo@x.example>" })
 *   neo.mail.hang("getFull")                // simulate a stalled IMAP fetch
 *   neo.store().messagesById                // the SPA store's state
 *   neo.mail.calls.compose                  // compose windows "opened"
 */
import { installFakeMessenger, settle, type FakeMessageSpec } from "../test/fakeMessenger";
import { forumMail, personalMail, promoMail } from "../test/fixtures";
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
  if (!params.has("keep")) await deleteDatabase("neoinbox");

  const mail = installFakeMessenger(seedMailbox());

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
    deliver: (what: Kind | FakeMessageSpec = "personal", folderId = INBOX): Promise<number> =>
      mail.deliver(folderId, typeof what === "string" ? KINDS[what]({ date: new Date() }) : { date: new Date(), ...what }),
  };
  (window as unknown as { neo: typeof neo }).neo = neo;

  await import("../spa/main");
};

void start();
