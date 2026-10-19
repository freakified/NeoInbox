import { log } from "../../shared/log";

export const REPO_URL = "https://github.com/freakified/NeoInbox";
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new`;

/**
 * Hands a web page to the system browser. A plain link would load inside
 * Thunderbird's tab, if at all.
 */
export const openExternal = (url: string): void => {
  messenger.windows.openDefaultBrowser(url).catch((e: unknown) => {
    log.warn("external", "opening a page in the browser failed", e);
  });
};
