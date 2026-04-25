import { ensureTagsRegistered } from "./tags";
import { backfillInbox, wireNewMailHandler, pinMessage, doneMessage, trashMessage } from "./ingest";
import { snoozeMessage, handleSnoozeAlarm } from "./snooze";
import type { Request } from "../shared/messaging";

const INBOX_URL = "inbox.html";

async function openOrFocusInbox(): Promise<void> {
  const tabs = await messenger.tabs.query({});
  const existing = tabs.find((t) => t.url?.endsWith(`/${INBOX_URL}`));
  if (existing?.id !== undefined) {
    await messenger.tabs.update(existing.id, { active: true });
    return;
  }
  await messenger.tabs.create({ url: INBOX_URL });
}

messenger.browserAction.onClicked.addListener(() => {
  void openOrFocusInbox();
});

void ensureTagsRegistered()
  .then(() => console.info("[NeoInbox] tags registered"))
  .catch((e) => console.warn("[NeoInbox] tag registration failed", e));

messenger.runtime.onInstalled.addListener(async (details) => {
  console.info("[NeoInbox] onInstalled", details.reason);
  await ensureTagsRegistered();
  void backfillInbox().catch((e) =>
    console.warn("[NeoInbox] backfill failed", e),
  );
});

messenger.runtime.onStartup.addListener(() => {
  void ensureTagsRegistered().catch(() => {});
});

messenger.alarms.onAlarm.addListener((alarm) => {
  void handleSnoozeAlarm(alarm.name);
});

wireNewMailHandler();

messenger.runtime.onMessage.addListener(async (msg: unknown) => {
  if (!msg || typeof msg !== "object") return;
  const req = msg as Request;
  try {
    switch (req.type) {
      case "ping":
        return { type: "pong", ts: Date.now() };
      case "backfill": {
        const result = await backfillInbox();
        return { type: "backfilled", ...result };
      }
      case "pin":
        await pinMessage(req.messageId, req.pinned);
        return { type: "ok" };
      case "done":
        await doneMessage(req.messageId, req.accountId);
        return { type: "ok" };
      case "trash":
        await trashMessage(req.messageId);
        return { type: "ok" };
      case "snooze":
        await snoozeMessage(req.messageId, req.wakeAt);
        return { type: "ok" };
      default:
        return;
    }
  } catch (e) {
    console.warn("[NeoInbox] message handler error", req, e);
    return { type: "error", message: String(e) };
  }
});

console.info("[NeoInbox] background ready");
