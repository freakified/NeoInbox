/**
 * Hash routing for the SPA. Lives here rather than in App so components deep
 * in the tree can navigate without prop-drilling a callback (or importing App
 * and creating a cycle) — App's hashchange listener picks up the change and
 * resets the view state either way.
 */
import type { StreamView } from "../../store/stream";

export const parseHashView = (): StreamView => {
  if (typeof window === "undefined") return { type: "inbox" };
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (raw === "snoozed") return { type: "snoozed" };
  if (raw === "draft") return { type: "draft" };
  if (raw === "sent") return { type: "sent" };
  if (raw === "done") return { type: "done" };
  if (raw === "reminders") return { type: "reminders" };
  if (raw === "trips") return { type: "trips" };
  // Trips used to ride on the retired "travel" category. Old hashes are still
  // in tab history and bookmarks, so keep honouring them.
  if (raw === "bundle/travel") return { type: "trips" };
  if (raw.startsWith("bundle/")) {
    const category = raw.slice("bundle/".length);
    if (category) return { type: "bundle", category };
  }
  return { type: "inbox" };
};

export const viewHash = (view: StreamView): string => {
  if (view.type === "bundle") return `#bundle/${encodeURIComponent(view.category)}`;
  return `#${view.type}`;
};

export const isSameView = (a: StreamView, b: StreamView): boolean =>
  a.type === b.type && (a.type !== "bundle" || b.type !== "bundle" || a.category === b.category);

/** Navigate from anywhere in the tree; App reacts via its hashchange listener. */
export const navigateToView = (view: StreamView): void => {
  if (typeof window === "undefined") return;
  const next = viewHash(view);
  if (window.location.hash === next) window.dispatchEvent(new Event("hashchange"));
  else window.location.hash = next;
};
