import { useSyncExternalStore } from "react";

const SHOW_DELETE_ACTIONS_KEY = "neoinbox.showDeleteActions";
const SHOW_DELETE_ACTIONS_EVENT = "neoinbox:show-delete-actions";

/**
 * Google Inbox never offered delete from the stream — only pin/snooze/done on
 * hover and sweep on sections. Delete actions are our extension, so they are
 * off until this pref turns them on: a trash-all next to every sweep is one
 * misclick from a bulk delete. Trash inside the opened conversation stays
 * regardless (Inbox had it there too).
 */
export const getShowDeleteActions = (): boolean =>
  localStorage.getItem(SHOW_DELETE_ACTIONS_KEY) === "true";

export const setShowDeleteActions = (show: boolean): void => {
  localStorage.setItem(SHOW_DELETE_ACTIONS_KEY, show ? "true" : "false");
  window.dispatchEvent(new Event(SHOW_DELETE_ACTIONS_EVENT));
};

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener(SHOW_DELETE_ACTIONS_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SHOW_DELETE_ACTIONS_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
};

export const useShowDeleteActions = (): boolean =>
  useSyncExternalStore(subscribe, getShowDeleteActions);
