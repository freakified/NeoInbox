/**
 * Where NeoInbox opens: a tab in Thunderbird's main window, or its own
 * popup window (almost no Thunderbird chrome). Lives in storage.local, not
 * localStorage, because the background page decides at startup, before any
 * NeoInbox page exists.
 */
export type OpenMode = "tab" | "window";

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const OPEN_MODE_KEY = "openMode";
const OPEN_ON_STARTUP_KEY = "openOnStartup";
const WINDOW_BOUNDS_KEY = "inboxWindowBounds";

export const getOpenMode = async (): Promise<OpenMode> => {
  const stored = await messenger.storage.local.get(OPEN_MODE_KEY);
  return stored[OPEN_MODE_KEY] === "window" ? "window" : "tab";
};

export const setOpenMode = async (mode: OpenMode): Promise<void> => {
  await messenger.storage.local.set({ [OPEN_MODE_KEY]: mode });
};

/** On unless turned off: NeoInbox is meant to be where you land. */
export const getOpenOnStartup = async (): Promise<boolean> => {
  const stored = await messenger.storage.local.get(OPEN_ON_STARTUP_KEY);
  return stored[OPEN_ON_STARTUP_KEY] !== false;
};

export const setOpenOnStartup = async (open: boolean): Promise<void> => {
  await messenger.storage.local.set({ [OPEN_ON_STARTUP_KEY]: open });
};

export const getWindowBounds = async (): Promise<WindowBounds | null> => {
  const stored = await messenger.storage.local.get(WINDOW_BOUNDS_KEY);
  const bounds = stored[WINDOW_BOUNDS_KEY] as WindowBounds | undefined;
  return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
};

export const setWindowBounds = async (bounds: WindowBounds): Promise<void> => {
  await messenger.storage.local.set({ [WINDOW_BOUNDS_KEY]: bounds });
};
