type Level = "debug" | "info" | "warn" | "error";

const emit = (level: Level, area: string, msg: string, data?: unknown): void => {
  const prefix = `[NeoInbox][${area}] ${msg}`;
  const fn = console[level] ?? console.log;
  if (data !== undefined) fn(prefix, data);
  else fn(prefix);
};

export const log = {
  debug: (area: string, msg: string, data?: unknown) => emit("debug", area, msg, data),
  info: (area: string, msg: string, data?: unknown) => emit("info", area, msg, data),
  warn: (area: string, msg: string, data?: unknown) => emit("warn", area, msg, data),
  error: (area: string, msg: string, data?: unknown) => emit("error", area, msg, data),
};

export const safeAsync = async <T>(
  area: string,
  fn: () => Promise<T>,
): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (e) {
    log.error(area, "boundary caught", e);
    return undefined;
  }
};
