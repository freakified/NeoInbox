/**
 * Inline compose through the full loop: SPA store → port → background →
 * (fake) Thunderbird compose window → result toast back in the SPA.
 */
import { describe, expect, it } from "vitest";
import type { ComposeDraft } from "../shared/compose";
import { settle, waitFor } from "./fakeMessenger";
import { boot, type Booted } from "./boot";
import { DRAFTS, INBOX, personalMail, shapes } from "./fixtures";

const open = async (): Promise<Booted> => {
  const app = await boot(shapes.standard());
  await app.store().init();
  await settle();
  return app;
};

const toastMessages = (app: Booted): string[] => app.store().toasts.map((t) => t.message);

describe("inline compose", () => {
  it("sends a reply with the typed text above Thunderbird's quote", async () => {
    const app = await open();
    const id = await app.mail.deliver(INBOX, personalMail());
    await settle();

    app.store().composeMessage(
      {
        kind: "replyAll",
        messageKey: app.mail.keyOf(id),
        to: ["Alex <alex@example.com>"],
        cc: [],
        text: "Sounds good\nsee you",
      },
      true,
    );
    expect(toastMessages(app)).toContain("Sending…");
    await waitFor(() => app.mail.calls.sent.length === 1);
    await settle();

    expect(app.mail.calls.compose.at(-1)).toMatchObject({
      kind: "reply",
      args: [id, "replyToAll", { to: ["Alex <alex@example.com>"], cc: [] }],
    });
    expect(app.mail.calls.sent[0]!.body).toBe(
      "<html><body><div>Sounds good<br>see you</div><br><blockquote>quoted</blockquote></body></html>",
    );
    // Focus went back to the window the user was in before the send ran.
    expect(app.mail.calls.focusedWindows).toEqual([1]);
    expect(toastMessages(app)).toContain("Message sent");
    expect(toastMessages(app)).not.toContain("Sending…");
  });

  it("sends an edited draft in place of what it said before, keeping the quote", async () => {
    const app = await open();
    const draftId = app.mail.insert(DRAFTS, personalMail());
    await app.backfill.runBackfill();
    app.store().composeMessage(
      {
        kind: "draft",
        messageKey: app.mail.keyOf(draftId),
        identityId: "id2",
        to: ["Ann <ann@example.com>"],
        cc: [],
        text: "New text",
        html: "<b>New</b> text",
      },
      true,
    );
    await waitFor(() => app.mail.calls.sent.length === 1);

    expect(app.mail.calls.compose.at(-1)).toMatchObject({
      kind: "new",
      args: [draftId, { to: ["Ann <ann@example.com>"], cc: [], identityId: "id2" }],
    });
    expect(app.mail.calls.sent[0]!.body).toBe(
      '<html><body><div><b>New</b> text</div><br><div class="moz-cite-prefix">On Mon, Ann wrote:</div><blockquote type="cite">quoted</blockquote></body></html>',
    );
  });

  it("leaves the window open, without sending, when finishing in Thunderbird", async () => {
    const app = await open();
    app.store().composeMessage(
      { kind: "new", to: ["bob@example.com"], cc: [], subject: "Hi", text: "Draft" },
      false,
    );
    await waitFor(() => app.mail.calls.compose.length === 1);
    await settle();

    expect(app.mail.calls.compose[0]).toMatchObject({
      kind: "new",
      args: [{ to: ["bob@example.com"], cc: [], subject: "Hi" }],
    });
    expect(app.mail.calls.sent).toEqual([]);
    expect(app.mail.calls.focusedWindows).toEqual([]);
    expect(toastMessages(app)).not.toContain("Sending…");
  });

  it("reports a failed send and brings the compose window forward", async () => {
    const app = await open();
    app.mail.failNextSend = "SMTP refused";
    app.store().composeMessage(
      { kind: "new", to: ["bob@example.com"], cc: [], subject: "Hi", text: "x" },
      true,
    );
    await waitFor(() => toastMessages(app).some((m) => m.startsWith("Couldn't send")));

    expect(toastMessages(app)).toContain(
      "Couldn't send — SMTP refused. It's still open in Thunderbird.",
    );
    // Back to the previous window for the send, then up to the compose window.
    expect(app.mail.calls.focusedWindows).toEqual([1, 100]);
  });

  it("attaches the user's files to the compose window before sending", async () => {
    const app = await open();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    app.store().composeMessage(
      { kind: "new", to: ["bob@example.com"], cc: [], subject: "Notes", text: "attached", attachments: [file] },
      true,
    );
    await waitFor(() => app.mail.calls.sent.length === 1);

    expect(app.mail.calls.sent[0]!.attachments).toEqual([{ file }]);
  });

  describe("pending replies", () => {
    const reply = (messageKey: string): ComposeDraft => ({
      kind: "reply",
      messageKey,
      to: ["Alex <alex@example.com>"],
      cc: [],
      text: "On my way",
    });
    const pending = {
      threadId: "t1",
      knownKeys: [],
      author: "Me <me@example.com>",
      to: ["Alex <alex@example.com>"],
      cc: [],
      text: "On my way",
    };

    it("shows the reply while it sends, and keeps it once sent until its Sent copy lands", async () => {
      const app = await open();
      const id = await app.mail.deliver(INBOX, personalMail());
      await settle();

      app.store().composeMessage(reply(app.mail.keyOf(id)), true, pending);
      expect(app.store().pendingReplies).toMatchObject([{ text: "On my way", status: "sending" }]);
      await waitFor(() => toastMessages(app).includes("Message sent"));
      await settle();

      const [sent] = app.store().pendingReplies;
      expect(sent?.status).toBe("sent");
      // Thunderbird filed the Sent copy, which is what replaces the preview.
      expect(
        Object.values(app.store().messagesByKey).some(
          (m) => m.origin === "sent" && m.recipients.includes("Alex <alex@example.com>"),
        ),
      ).toBe(true);
      app.store().settlePendingReply(sent!.requestId);
      expect(app.store().pendingReplies).toEqual([]);
    });

    it("drops the preview when the send fails, since it's still open in Thunderbird", async () => {
      const app = await open();
      const id = await app.mail.deliver(INBOX, personalMail());
      await settle();
      app.mail.failNextSend = "SMTP refused";

      app.store().composeMessage(reply(app.mail.keyOf(id)), true, pending);
      await waitFor(() => toastMessages(app).some((m) => m.startsWith("Couldn't send")));
      expect(app.store().pendingReplies).toEqual([]);
    });

    it("shows nothing for a reply opened in Thunderbird to finish", async () => {
      const app = await open();
      const id = await app.mail.deliver(INBOX, personalMail());
      await settle();

      app.store().composeMessage(reply(app.mail.keyOf(id)), false, pending);
      expect(app.store().pendingReplies).toEqual([]);
    });
  });
});
