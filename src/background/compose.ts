/**
 * Sends (or hands off) an inline draft through a real Thunderbird compose
 * window. The MailExtension API has no headless send, so for "send" the window
 * flashes up while Thunderbird sends and closes itself on success; hiding it
 * (minimize, off-screen) was tried and looked worse than just letting it show.
 *
 * Thunderbird builds the reply as it normally would — identity, quote,
 * signature, plain/HTML — and the user's text goes on top of that. A saved
 * draft reopens as Thunderbird's own draft (so sending it clears it from
 * Drafts), with the user's part of its body swapped for the edited text.
 */
import {
  prependToHtmlBody,
  prependToPlainBody,
  replaceDraftHtmlBody,
  replaceDraftPlainBody,
  textToHtml,
  type ComposeDraft,
} from "../shared/compose";
import { log } from "../shared/log";

const begin = (draft: ComposeDraft): Promise<messenger.tabs.Tab> => {
  const details: messenger.compose.ComposeDetails = { to: draft.to, cc: draft.cc };
  if (draft.identityId) details.identityId = draft.identityId;
  if (draft.kind === "new") {
    return messenger.compose.beginNew({ ...details, subject: draft.subject ?? "" });
  }
  if (draft.messageId === undefined) throw new Error(`${draft.kind} needs a message`);
  if (draft.kind === "draft") return messenger.compose.beginNew(draft.messageId, details);
  if (draft.kind === "forward") {
    return messenger.compose.beginForward(draft.messageId, "forwardInline", details);
  }
  return messenger.compose.beginReply(
    draft.messageId,
    draft.kind === "reply" ? "replyToSender" : "replyToAll",
    details,
  );
};

const htmlFor = (text: string, html?: string): string =>
  html ? `<div>${html}</div><br>` : textToHtml(text);

const insertText = async (tabId: number, text: string, html?: string): Promise<void> => {
  if (!text.trim()) return;
  const current = await messenger.compose.getComposeDetails(tabId);
  if (current.isPlainText) {
    await messenger.compose.setComposeDetails(tabId, {
      plainTextBody: prependToPlainBody(current.plainTextBody ?? "", text),
    });
  } else {
    await messenger.compose.setComposeDetails(tabId, {
      body: prependToHtmlBody(current.body ?? "", htmlFor(text, html)),
    });
  }
};

/** Replaces what the user had written in a reopened draft (even with nothing). */
const replaceDraftText = async (tabId: number, text: string, html?: string): Promise<void> => {
  const current = await messenger.compose.getComposeDetails(tabId);
  if (current.isPlainText) {
    await messenger.compose.setComposeDetails(tabId, {
      plainTextBody: replaceDraftPlainBody(current.plainTextBody ?? "", text),
    });
  } else {
    await messenger.compose.setComposeDetails(tabId, {
      body: replaceDraftHtmlBody(current.body ?? "", text.trim() ? htmlFor(text, html) : ""),
    });
  }
};

export type ComposeOutcome =
  | { outcome: "sent" | "opened" }
  | { outcome: "failed"; error: string };

export const runCompose = async (
  draft: ComposeDraft,
  send: boolean,
): Promise<ComposeOutcome> => {
  const previous = await messenger.windows.getLastFocused().catch(() => undefined);
  const tab = await begin(draft);
  const tabId = tab.id;
  if (tabId === undefined) return { outcome: "failed", error: "No compose window" };

  try {
    if (draft.kind === "draft") await replaceDraftText(tabId, draft.text, draft.html);
    else await insertText(tabId, draft.text, draft.html);
  } catch (e) {
    // The window is open with Thunderbird's own reply; let the user finish it.
    log.warn("compose", "couldn't insert text", e);
    return { outcome: "failed", error: "Couldn't fill in your message" };
  }
  if (!send) return { outcome: "opened" };

  // Opening the window took focus; hand it back while the send runs.
  if (previous?.id !== undefined) {
    await messenger.windows.update(previous.id, { focused: true }).catch(() => undefined);
  }
  try {
    await messenger.compose.sendMessage(tabId);
    return { outcome: "sent" };
  } catch (e) {
    // Thunderbird leaves the window open after a failed send; bring it up so
    // the user can see its error and retry from there.
    log.warn("compose", "send failed", e);
    if (tab.windowId !== undefined) {
      await messenger.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    }
    return { outcome: "failed", error: e instanceof Error ? e.message : String(e) };
  }
};
