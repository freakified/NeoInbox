import { setWindowBounds } from "../../shared/openMode";
import { log } from "../../shared/log";

/**
 * Thunderbird has no windows.onBoundsChanged, so the NeoInbox popup window
 * reports its own size and position, letting the next one open where this
 * one was. Does nothing when NeoInbox is a tab in the main window.
 */
export const trackPopupWindowBounds = async (): Promise<void> => {
  const current = await messenger.windows.getCurrent().catch(() => undefined);
  if (current?.type !== "popup") return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void setWindowBounds({
        left: window.screenX,
        top: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      }).catch((e) => log.warn("window", "saving bounds failed", e));
    }, 500);
  };
  // Moving a window fires no DOM event; polling a cheap read covers it.
  let last = "";
  setInterval(() => {
    const next = `${window.screenX},${window.screenY},${window.outerWidth},${window.outerHeight}`;
    if (next !== last) {
      last = next;
      save();
    }
  }, 2000);
};
