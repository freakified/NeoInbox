import { CATEGORIES } from "../shared/categories";

type ListFn = () => Promise<messenger.messages.tags.MessageTag[]>;
type CreateFn = (key: string, name: string, color: string) => Promise<unknown>;

const resolveTagApi = (): { list?: ListFn; create?: CreateFn } => {
  const m = messenger.messages as unknown as {
    tags?: { list?: ListFn; create?: CreateFn };
    listTags?: ListFn;
    createTag?: CreateFn;
  };
  const top = messenger as unknown as {
    tags?: { list?: ListFn; create?: CreateFn };
  };
  const list =
    typeof top.tags?.list === "function"
      ? top.tags.list.bind(top.tags)
      : typeof m.tags?.list === "function"
        ? m.tags.list.bind(m.tags)
        : typeof m.listTags === "function"
          ? m.listTags.bind(m)
          : undefined;
  const create =
    typeof top.tags?.create === "function"
      ? top.tags.create.bind(top.tags)
      : typeof m.tags?.create === "function"
        ? m.tags.create.bind(m.tags)
        : typeof m.createTag === "function"
          ? m.createTag.bind(m)
          : undefined;

  console.info("[NeoInbox] tag API detection", {
    hasTopTagsNs: !!top.tags,
    topTagsKeys: top.tags ? Object.keys(top.tags) : null,
    topTagsListType: typeof top.tags?.list,
    topTagsCreateType: typeof top.tags?.create,
    hasMsgsTagsNs: !!m.tags,
    msgsTagsKeys: m.tags ? Object.keys(m.tags) : null,
    msgsTagsListType: typeof m.tags?.list,
    msgsTagsCreateType: typeof m.tags?.create,
    legacyListType: typeof m.listTags,
    legacyCreateType: typeof m.createTag,
    resolvedList: !!list,
    resolvedCreate: !!create,
  });

  return { list, create };
}

export const ensureTagsRegistered = async (): Promise<void> => {
  const { list, create } = resolveTagApi();
  if (!list || !create) {
    console.warn(
      "[NeoInbox] tag registration skipped — API unavailable; classification will still apply tag keys to messages, but native UI won't show tag names/colors",
    );
    return;
  }
  let existing: messenger.messages.tags.MessageTag[] = [];
  try {
    existing = await list();
  } catch (e) {
    console.warn("[NeoInbox] listTags failed", e);
    return;
  }
  const byKey = new Set(existing.map((t) => t.key));
  for (const meta of Object.values(CATEGORIES)) {
    if (!meta.key || byKey.has(meta.key)) continue;
    try {
      await create(meta.key, meta.name, meta.color);
      console.debug("[NeoInbox] created tag", meta.key);
    } catch (e) {
      console.warn("[NeoInbox] failed to create tag", meta.key, e);
    }
  }
}
