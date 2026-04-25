import { classifyAndTag } from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { db } from "../store/db";
import { categoryFromTags } from "../shared/categories";

type OnUpdatedApi = {
  addListener: (
    cb: (
      message: messenger.messages.MessageHeader,
      changedProperties: { tags?: string[]; read?: boolean },
    ) => void,
  ) => void;
};

export function wireSyncEngine(): void {
  messenger.messages.onNewMailReceived.addListener(async (_folder, list) => {
    const added = [];
    for (const header of list.messages) {
      const before = categoryFromTags(header.tags);
      const cat = before ?? (await classifyAndTag(header)) ?? null;
      const fresh = await messenger.messages.get(header.id);
      const raw = headerToRawMessage(fresh, "inbox", cat);
      added.push(raw);
    }
    if (!added.length) return;
    await db.messages.bulkPut(added);
    broadcast({ type: "delta", added });
  });

  const onUpdated = (
    messenger.messages as unknown as { onUpdated?: OnUpdatedApi }
  ).onUpdated;
  if (onUpdated) {
    onUpdated.addListener(async (header) => {
      const fresh = await messenger.messages.get(header.id);
      const cached = await db.messages.get(header.id);
      const origin = cached?.origin ?? "inbox";
      const raw = headerToRawMessage(fresh, origin);
      await db.messages.put(raw);
      broadcast({ type: "delta", updated: [raw] });
    });
  }
}

export async function pushMyEmails(): Promise<void> {
  const accounts = await messenger.accounts.list();
  const emails: string[] = [];
  for (const acc of accounts) {
    const identities = (
      acc as unknown as { identities?: { email?: string }[] }
    ).identities ?? [];
    for (const id of identities) {
      if (id.email) emails.push(id.email.toLowerCase());
    }
  }
  broadcast({ type: "myEmails", emails });
}
