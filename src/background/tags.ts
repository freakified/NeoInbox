import { CATEGORIES, PINNED_KEY, SNOOZED_KEY } from "../shared/categories";
import { log } from "../shared/log";

type ListFn = () => Promise<messenger.messages.tags.MessageTag[]>;
type CreateFn = (key: string, name: string, color: string) => Promise<unknown>;

interface TagApi {
  list?: ListFn;
  create?: CreateFn;
}

let cachedApi: TagApi | null = null;
let registration: Promise<void> | null = null;

/**
 * Every tag key we ever write with messages.update. Thunderbird drops tag
 * keys that aren't in its registry (and filters them out of reads), so an
 * unregistered key makes the write a silent no-op.
 */
const TAG_SPECS: ReadonlyArray<{ key: string; name: string; color: string }> = [
  ...Object.values(CATEGORIES)
    .filter((m) => m.key)
    .map((m) => ({ key: m.key, name: m.name, color: m.color })),
  { key: PINNED_KEY, name: "Pinned", color: "#4285F4" },
  { key: SNOOZED_KEY, name: "Snoozed", color: "#DF742C" },
];

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

const registerTags = async (): Promise<void> => {
  const { list, create } = resolveTagApi();

  if (!create) {
    log.warn(
      "tags",
      "tag registration skipped — create unavailable; tag writes for unregistered keys will be dropped by Thunderbird",
    );
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

  for (const spec of TAG_SPECS) {
    if (existingKeys?.has(spec.key)) continue;
    try {
      await create(spec.key, spec.name, spec.color);
      log.debug("tags", "created", spec.key);
    } catch (e) {
      // When list() is unavailable we expect "already exists" errors; swallow.
      if (existingKeys) log.warn("tags", "failed to create", { key: spec.key, e });
    }
  }
};

export const ensureTagsRegistered = (): Promise<void> => {
  registration ??= registerTags();
  return registration;
};
