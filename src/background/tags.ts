import { CATEGORIES } from "../shared/categories";
import { log } from "../shared/log";

type ListFn = () => Promise<messenger.messages.tags.MessageTag[]>;
type CreateFn = (key: string, name: string, color: string) => Promise<unknown>;

interface TagApi {
  list?: ListFn;
  create?: CreateFn;
}

let cachedApi: TagApi | null = null;
let registered = false;

const resolveTagApi = (): TagApi => {
  if (cachedApi) return cachedApi;

  const top = (messenger as unknown as { tags?: { list?: ListFn; create?: CreateFn } }).tags;
  const ns = (messenger.messages as unknown as { tags?: { list?: ListFn; create?: CreateFn } }).tags;

  const listSource = typeof top?.list === "function" ? top : typeof ns?.list === "function" ? ns : undefined;
  const createSource = typeof top?.create === "function" ? top : typeof ns?.create === "function" ? ns : undefined;

  cachedApi = {
    list: listSource ? (listSource.list as ListFn).bind(listSource) : undefined,
    create: createSource ? (createSource.create as CreateFn).bind(createSource) : undefined,
  };

  log.info("tags", "API resolved", {
    hasList: !!cachedApi.list,
    hasCreate: !!cachedApi.create,
  });

  return cachedApi;
};

export const ensureTagsRegistered = async (): Promise<void> => {
  if (registered) return;
  const { list, create } = resolveTagApi();

  if (!create) {
    log.warn(
      "tags",
      "tag registration skipped — create unavailable; classification will still apply tag keys but native UI won't show names/colors",
    );
    registered = true;
    return;
  }

  let existingKeys: Set<string> | null = null;
  if (list) {
    try {
      const existing = await list();
      existingKeys = new Set(existing.map((t) => t.key));
    } catch (e) {
      log.warn("tags", "list failed; will create blindly", e);
    }
  }

  for (const meta of Object.values(CATEGORIES)) {
    if (!meta.key) continue;
    if (existingKeys?.has(meta.key)) continue;
    try {
      await create(meta.key, meta.name, meta.color);
      log.debug("tags", "created", meta.key);
    } catch (e) {
      // When list() is unavailable we expect "already exists" errors; swallow.
      if (existingKeys) log.warn("tags", "failed to create", { key: meta.key, e });
    }
  }

  registered = true;
};
