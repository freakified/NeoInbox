import manifest from "../../../public/manifest.json";
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

/** What a bug report needs to be reproduced, best effort. */
const environment = async (): Promise<string> => {
  const [browser, platform] = await Promise.all([
    messenger.runtime.getBrowserInfo().catch(() => null),
    messenger.runtime.getPlatformInfo().catch(() => null),
  ]);
  return [
    `- NeoInbox: ${manifest.version}`,
    browser && `- ${browser.name}: ${browser.version}`,
    platform && `- OS: ${platform.os} (${platform.arch})`,
  ].filter(Boolean).join("\n");
};

/**
 * Opens a new GitHub issue with a template body filled in. GitHub ignores the
 * labels for anyone without triage rights, so the title prefix carries the
 * kind too.
 */
export const openNewIssue = async (kind: "bug" | "feature"): Promise<void> => {
  const params = new URLSearchParams(
    kind === "bug"
      ? {
        title: "Bug: ",
        labels: "bug",
        body: [
          "**What happened?**\n\n",
          "**What did you expect to happen?**\n\n",
          "**Steps to reproduce**\n1. \n",
          `**Environment**\n${await environment()}\n`,
        ].join("\n"),
      }
      : {
        title: "Feature request: ",
        labels: "enhancement",
        body: [
          "**What would you like NeoInbox to do?**\n\n",
          "**Did the real Google Inbox do this? How did it work there? (Screenshots appreciated!)**\n",
        ].join("\n"),
      },
  );
  openExternal(`${NEW_ISSUE_URL}?${params}`);
};
