/**
 * An in-memory stand-in for the Thunderbird `messenger.*` API, good enough to
 * run the real background modules against.
 *
 * It is stateful: archive/move/delete relocate messages between folders, and
 * the message events fire the way Thunderbird fires them. What makes it worth
 * having over a plain mock is the failure injection — the bugs this codebase
 * has actually hit came from bodies that weren't downloaded yet, folder
 * listings that stalled, and ids Thunderbird renumbered between sessions, so
 * all three are first-class here.
 */

type Listener<A extends unknown[]> = (...args: A) => unknown;

class Event<A extends unknown[]> {
  readonly listeners: Listener<A>[] = [];
  addListener = (cb: Listener<A>): void => {
    this.listeners.push(cb);
  };
  removeListener = (cb: Listener<A>): void => {
    const i = this.listeners.indexOf(cb);
    if (i >= 0) this.listeners.splice(i, 1);
  };
  hasListener = (cb: Listener<A>): boolean => this.listeners.includes(cb);
  /** Fires listeners and awaits them, so tests can assert on settled state. */
  emit = async (...args: A): Promise<void> => {
    for (const cb of [...this.listeners]) await cb(...args);
  };
  /** Fires listeners without awaiting, for the APIs Thunderbird calls synchronously. */
  emitSync = (...args: A): void => {
    for (const cb of [...this.listeners]) track(cb(...args));
  };
}

/**
 * Work kicked off by a synchronous dispatch. Handlers on both sides of the
 * port are async, so tests need a way to wait for the consequences of a
 * message rather than just its delivery.
 */
const inFlight: Promise<unknown>[] = [];

const track = (value: unknown): void => {
  if (value && typeof (value as Promise<unknown>).then === "function") {
    inFlight.push(value as Promise<unknown>);
  }
};

/**
 * Drains everything the last dispatch set in motion, including follow-on work.
 *
 * Runs a fixed number of macrotask turns rather than stopping at the first
 * quiet one: handlers on both sides hand off through Dexie, whose callbacks
 * land a turn later, so an early exit would sample the state mid-flight.
 */
export const settle = async (rounds = 12): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    const batch = inFlight.splice(0, inFlight.length);
    if (batch.length) await Promise.allSettled(batch);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/**
 * Waits for a condition instead of a fixed number of turns. Needed for the
 * paths that deliberately take wall-clock time — archive failures retry on a
 * ladder of sleeps before giving up, so the outcome arrives seconds later.
 */
export const waitFor = async (
  predicate: () => boolean,
  label = "condition",
  timeoutMs = 10_000,
): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * One end of a port. Two are linked back to back so the real SPA store and the
 * real background port server can talk to each other in one process.
 */
export class FakePort {
  readonly sent: unknown[] = [];
  readonly onMessage = new Event<[unknown]>();
  readonly onDisconnect = new Event<[]>();
  peer: FakePort | null = null;

  constructor(readonly name: string) {}

  postMessage = (msg: unknown): void => {
    this.sent.push(msg);
    if (!this.peer) return;
    this.peer.onMessage.emitSync(msg);
  };

  /** Drops the connection, as a background restart would. */
  disconnect = (): void => {
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      peer.peer = null;
      peer.onDisconnect.emitSync();
    }
    this.onDisconnect.emitSync();
  };
}

const linkPorts = (name: string): { client: FakePort; server: FakePort } => {
  const client = new FakePort(name);
  const server = new FakePort(name);
  client.peer = server;
  server.peer = client;
  return { client, server };
};

export interface FakeMessageSpec {
  id?: number;
  headerMessageId?: string;
  author?: string;
  subject?: string;
  date?: Date | number;
  read?: boolean;
  tags?: string[];
  size?: number;
  recipients?: string[];
  ccList?: string[];
  bccList?: string[];
  /** Full headers getFull() returns — where every List-* classifier rule looks. */
  headers?: Record<string, string[]>;
  /** HTML body, only needed by attachment/cid tests. */
  html?: string;
  /**
   * When true getFull() rejects, reproducing an IMAP message whose body has
   * not been synced yet. This is the state a backlog arrives in, and the
   * reason classification can decide a category from headers alone.
   */
  bodyUnavailable?: boolean;
}

export interface FakeFolderSpec {
  id: string;
  name?: string;
  /** Modern role marker; `type` is the deprecated fallback some setups still use. */
  specialUse?: string[];
  type?: string;
  messages?: FakeMessageSpec[];
}

export interface FakeAccountSpec {
  id: string;
  name?: string;
  identities?: { email: string }[];
  folders: FakeFolderSpec[];
}

export interface FakeMessengerOptions {
  accounts: FakeAccountSpec[];
  /** Page size for list()/query(); small values exercise continueList paging. */
  pageSize?: number;
}

interface StoredMessage {
  id: number;
  folderId: string;
  headerMessageId: string;
  author: string;
  subject: string;
  date: Date;
  read: boolean;
  tags: string[];
  size: number;
  recipients: string[];
  ccList: string[];
  bccList: string[];
  headers: Record<string, string[]>;
  html?: string;
  bodyUnavailable: boolean;
}

export type HangableCall = "list" | "continueList" | "query" | "getFull" | "getFolderInfo";

const never = (): Promise<never> => new Promise<never>(() => {});

export class FakeMessenger {
  private messages = new Map<number, StoredMessage>();
  private folderOwner = new Map<string, string>();
  private folderSpecs = new Map<string, FakeFolderSpec>();
  private pages = new Map<string, StoredMessage[]>();
  private nextId = 1;
  private nextPage = 1;
  private hanging = new Set<HangableCall>();
  private failing = new Map<HangableCall, string>();

  readonly storageData: Record<string, unknown> = {};
  readonly alarmsCreated = new Map<string, unknown>();
  /**
   * Call counts, for asserting on cost rather than just correctness. `query`
   * matters most: a Message-ID lookup walks the account and is the expensive
   * path a sweep has to ration.
   */
  readonly calls = { getFull: [] as number[], query: 0, list: 0 };

  constructor(private options: FakeMessengerOptions) {
    for (const account of options.accounts) {
      for (const folder of account.folders) {
        this.folderOwner.set(folder.id, account.id);
        this.folderSpecs.set(folder.id, folder);
        for (const spec of folder.messages ?? []) this.insert(folder.id, spec);
      }
    }
  }

  // ---------------------------------------------------------------- fixtures

  /** Adds a message and returns its id, without firing events. */
  insert(folderId: string, spec: FakeMessageSpec = {}): number {
    const id = spec.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    this.messages.set(id, {
      id,
      folderId,
      headerMessageId: spec.headerMessageId ?? `<msg-${id}@example.com>`,
      author: spec.author ?? "Someone <someone@example.com>",
      subject: spec.subject ?? `Message ${id}`,
      date: spec.date instanceof Date ? spec.date : new Date(spec.date ?? Date.now()),
      read: spec.read ?? false,
      tags: spec.tags ?? [],
      size: spec.size ?? 1024,
      recipients: spec.recipients ?? ["me@example.com"],
      ccList: spec.ccList ?? [],
      bccList: spec.bccList ?? [],
      headers: spec.headers ?? {},
      html: spec.html,
      bodyUnavailable: spec.bodyUnavailable ?? false,
    });
    return id;
  }

  /** Adds a message and fires onNewMailReceived, as a delivery would. */
  async deliver(folderId: string, spec: FakeMessageSpec = {}): Promise<number> {
    const id = this.insert(folderId, spec);
    await this.messagesApi.onNewMailReceived.emit(this.folderRef(folderId), {
      id: null,
      messages: [{ id }],
    });
    return id;
  }

  /**
   * Renumbers every message, preserving Message-IDs — what Thunderbird does
   * when it rebuilds a folder database, and what strands cached numeric ids.
   */
  remapIds(offset = 10_000): void {
    const remapped = new Map<number, StoredMessage>();
    for (const msg of this.messages.values()) {
      const id = msg.id + offset;
      remapped.set(id, { ...msg, id });
    }
    this.messages = remapped;
    this.nextId += offset;
  }

  /** Makes the named call never settle, as a stalled IMAP connection would. */
  hang(call: HangableCall): void {
    this.hanging.add(call);
  }

  unhang(call: HangableCall): void {
    this.hanging.delete(call);
  }

  /**
   * Makes the named call reject immediately. The fast-failing equivalent of
   * hang() for asserting that a broken scan still releases the queue flag,
   * without waiting out the real timeout.
   */
  fail(call: HangableCall, message = `${call} failed`): void {
    this.failing.set(call, message);
  }

  unfail(call: HangableCall): void {
    this.failing.delete(call);
  }

  private guard(call: HangableCall): Promise<never> | null {
    const failure = this.failing.get(call);
    if (failure) return Promise.reject(new Error(failure));
    if (this.hanging.has(call)) return never();
    return null;
  }

  idsIn(folderId: string): number[] {
    return [...this.messages.values()]
      .filter((m) => m.folderId === folderId)
      .map((m) => m.id)
      .sort((a, b) => a - b);
  }

  folderOf(id: number): string | undefined {
    return this.messages.get(id)?.folderId;
  }

  // ------------------------------------------------------------------ shared

  private folderRef(folderId: string): { id: string; accountId: string; name: string } {
    return {
      id: folderId,
      accountId: this.folderOwner.get(folderId) ?? "",
      name: this.folderSpecs.get(folderId)?.name ?? folderId,
    };
  }

  private header(msg: StoredMessage): messenger.messages.MessageHeader {
    return {
      id: msg.id,
      headerMessageId: msg.headerMessageId,
      subject: msg.subject,
      author: msg.author,
      recipients: msg.recipients,
      ccList: msg.ccList,
      bccList: msg.bccList,
      date: msg.date,
      read: msg.read,
      size: msg.size,
      tags: msg.tags,
      folder: this.folderRef(msg.folderId),
    } as unknown as messenger.messages.MessageHeader;
  }

  private require(id: number): StoredMessage {
    const msg = this.messages.get(id);
    if (!msg) throw new Error(`Message not found: ${id}.`);
    return msg;
  }

  private paginate(rows: StoredMessage[]): { id: string | null; messages: messenger.messages.MessageHeader[] } {
    const size = this.options.pageSize ?? Number.MAX_SAFE_INTEGER;
    const head = rows.slice(0, size);
    const tail = rows.slice(size);
    let pageId: string | null = null;
    if (tail.length) {
      pageId = `page-${this.nextPage++}`;
      this.pages.set(pageId, tail);
    }
    return { id: pageId, messages: head.map((m) => this.header(m)) };
  }

  private folderIdOf(ref: unknown): string {
    if (typeof ref === "string") return ref;
    return (ref as { id?: string })?.id ?? "";
  }

  private archiveFolderFor(accountId: string): string | undefined {
    for (const folder of this.folderSpecs.values()) {
      if (
        this.folderOwner.get(folder.id) === accountId &&
        (folder.specialUse?.includes("archives") || folder.type === "archives")
      ) {
        return folder.id;
      }
    }
    return undefined;
  }

  private async moveInternal(ids: number[], targetId: string): Promise<messenger.messages.MessageHeader[]> {
    const originals = ids.map((id) => this.require(id));
    const moved: StoredMessage[] = [];
    for (const msg of originals) {
      msg.folderId = targetId;
      moved.push(msg);
    }
    await this.messagesApi.onMoved.emit(
      { id: null, messages: originals.map((m) => ({ id: m.id })) },
      { id: null, messages: moved.map((m) => ({ id: m.id })) },
    );
    return moved.map((m) => this.header(m));
  }

  // --------------------------------------------------------------------- api

  readonly messagesApi = {
    onNewMailReceived: new Event<[{ id: string; accountId: string; name: string }, { id: string | null; messages: { id: number }[] }]>(),
    onUpdated: new Event<[messenger.messages.MessageHeader, { tags?: string[]; read?: boolean }]>(),
    onDeleted: new Event<[{ id: string | null; messages: { id: number }[] }]>(),
    onMoved: new Event<[{ id: string | null; messages: { id: number }[] }, { id: string | null; messages: { id: number }[] }]>(),

    get: async (id: number) => this.header(this.require(id)),

    getFull: async (id: number) => {
      const blocked = this.guard("getFull");
      if (blocked) return blocked;
      this.calls.getFull.push(id);
      const msg = this.require(id);
      // The whole point of the flag: a body Thunderbird hasn't fetched yet
      // makes getFull reject, and classification falls back to bare headers.
      if (msg.bodyUnavailable) throw new Error(`Message not available offline: ${id}`);
      return {
        contentType: "message/rfc822",
        headers: msg.headers,
        parts: msg.html
          ? [{ contentType: "text/html", body: msg.html, parts: [] }]
          : [],
      } as unknown as messenger.messages.MessagePart;
    },

    list: async (ref: unknown) => {
      const blocked = this.guard("list");
      if (blocked) return blocked;
      this.calls.list++;
      const folderId = this.folderIdOf(ref);
      return this.paginate([...this.messages.values()].filter((m) => m.folderId === folderId));
    },

    continueList: async (pageId: string) => {
      const blocked = this.guard("continueList");
      if (blocked) return blocked;
      const rows = this.pages.get(pageId) ?? [];
      this.pages.delete(pageId);
      return this.paginate(rows);
    },

    query: async (q: {
      folderId?: unknown;
      fromDate?: Date;
      headerMessageId?: string;
      accountId?: string;
    }) => {
      const blocked = this.guard("query");
      if (blocked) return blocked;
      this.calls.query++;
      let rows = [...this.messages.values()];
      if (q.folderId !== undefined) {
        const folderId = this.folderIdOf(q.folderId);
        rows = rows.filter((m) => m.folderId === folderId);
      }
      if (q.accountId !== undefined) {
        rows = rows.filter((m) => this.folderOwner.get(m.folderId) === q.accountId);
      }
      if (q.headerMessageId !== undefined) {
        rows = rows.filter((m) => m.headerMessageId === q.headerMessageId);
      }
      if (q.fromDate) {
        const from = q.fromDate.getTime();
        rows = rows.filter((m) => m.date.getTime() >= from);
      }
      return this.paginate(rows);
    },

    move: async (ids: number[], target: unknown) =>
      ({ messages: await this.moveInternal(ids, this.folderIdOf(target)) }),

    archive: async (ids: number[]) => {
      for (const id of ids) {
        const msg = this.require(id);
        const accountId = this.folderOwner.get(msg.folderId) ?? "";
        const target = this.archiveFolderFor(accountId);
        if (!target) throw new Error("No Archives folder configured for this account");
        await this.moveInternal([id], target);
      }
    },

    delete: async (ids: number[], _options?: unknown) => {
      for (const id of ids) this.require(id);
      for (const id of ids) this.messages.delete(id);
      await this.messagesApi.onDeleted.emit({ id: null, messages: ids.map((id) => ({ id })) });
    },

    update: async (id: number, props: { read?: boolean; tags?: string[] }) => {
      const msg = this.require(id);
      if (props.read !== undefined) msg.read = props.read;
      if (props.tags !== undefined) msg.tags = props.tags;
      await this.messagesApi.onUpdated.emit(this.header(msg), props);
    },

    listAttachments: async (id: number) => {
      this.require(id);
      return [];
    },

    getAttachmentFile: async () => new Blob([]),
  };

  readonly foldersApi = {
    onCreated: new Event<[]>(),
    onRenamed: new Event<[]>(),
    onMoved: new Event<[]>(),
    onDeleted: new Event<[]>(),
    onUpdated: new Event<[]>(),
    getFolderInfo: async (ref: unknown) => {
      const blocked = this.guard("getFolderInfo");
      if (blocked) return blocked;
      const folderId = this.folderIdOf(ref);
      return {
        totalMessageCount: [...this.messages.values()].filter((m) => m.folderId === folderId).length,
        unreadMessageCount: 0,
      };
    },
  };

  readonly alarmsApi = {
    onAlarm: new Event<[{ name: string }]>(),
    create: async (name: string, info: unknown) => {
      this.alarmsCreated.set(name, info);
    },
    clear: async (name: string) => this.alarmsCreated.delete(name),
  };

  /** Client ends handed out by runtime.connect, newest last. */
  readonly ports: FakePort[] = [];

  readonly runtimeApi = {
    onStartup: new Event<[]>(),
    onInstalled: new Event<[{ reason: string }]>(),
    onConnect: new Event<[FakePort]>(),
    connect: ({ name }: { name: string }): FakePort => {
      const { client, server } = linkPorts(name);
      this.ports.push(client);
      // Thunderbird hands the background its end synchronously, before
      // connect() returns to the caller.
      this.runtimeApi.onConnect.emitSync(server);
      return client;
    },
  };

  /** The most recent client-side port, i.e. the one the SPA store is holding. */
  get port(): FakePort | undefined {
    return this.ports[this.ports.length - 1];
  }

  /** The object to install as `globalThis.messenger`. */
  api(): typeof messenger {
    const self = this;
    return {
      messages: this.messagesApi,
      folders: this.foldersApi,
      alarms: this.alarmsApi,
      runtime: this.runtimeApi,
      accounts: {
        list: async () =>
          self.options.accounts.map((acc) => ({
            id: acc.id,
            name: acc.name ?? acc.id,
            identities: acc.identities ?? [{ email: `${acc.id}@example.com` }],
            folders: acc.folders.map((f) => ({
              id: f.id,
              name: f.name ?? f.id,
              path: `/${f.id}`,
              accountId: acc.id,
              specialUse: f.specialUse,
              type: f.type,
              subFolders: [],
            })),
          })),
      },
      storage: {
        local: {
          get: async (key: string) =>
            key in self.storageData ? { [key]: self.storageData[key] } : {},
          set: async (values: Record<string, unknown>) => {
            Object.assign(self.storageData, values);
          },
          remove: async (key: string) => {
            delete self.storageData[key];
          },
        },
      },
      tabs: {
        query: async () => [],
        create: async () => ({ id: 1 }),
        update: async () => ({ id: 1 }),
      },
      browserAction: { onClicked: new Event<[]>() },
      compose: {
        onAfterSend: new Event<[unknown, unknown]>(),
        onAfterSave: new Event<[unknown, unknown]>(),
        onBeforeSend: new Event<[unknown, unknown]>(),
      },
    } as unknown as typeof messenger;
  }
}

/** Builds a fake and installs it as the global `messenger`. */
export const installFakeMessenger = (options: FakeMessengerOptions): FakeMessenger => {
  const fake = new FakeMessenger(options);
  (globalThis as Record<string, unknown>).messenger = fake.api();
  return fake;
};
