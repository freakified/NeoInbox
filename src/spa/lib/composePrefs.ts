import { useSyncExternalStore } from "react";

const COMPOSE_MODE_KEY = "neoinbox.composeMode";
const COMPOSE_MODE_EVENT = "neoinbox:compose-mode";

/**
 * How replies and new mail are written:
 * - "send": inline, Google Inbox style; Send goes out through a Thunderbird
 *   compose window that shows briefly while it sends.
 * - "review": inline, but the draft opens in Thunderbird's compose window to
 *   be finished and sent there.
 * - "thunderbird": skip the inline composer and open Thunderbird's directly.
 */
export type ComposeMode = "send" | "review" | "thunderbird";

const MODES: readonly ComposeMode[] = ["send", "review", "thunderbird"];

export const getComposeMode = (): ComposeMode => {
  try {
    const stored = localStorage.getItem(COMPOSE_MODE_KEY);
    return MODES.includes(stored as ComposeMode) ? (stored as ComposeMode) : "send";
  } catch {
    return "send";
  }
};

export const setComposeMode = (mode: ComposeMode): void => {
  try {
    localStorage.setItem(COMPOSE_MODE_KEY, mode);
  } catch {
    // Storage unavailable; the choice just won't stick.
  }
  window.dispatchEvent(new Event(COMPOSE_MODE_EVENT));
};

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener(COMPOSE_MODE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(COMPOSE_MODE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
};

export const useComposeMode = (): ComposeMode =>
  useSyncExternalStore(subscribe, getComposeMode);
