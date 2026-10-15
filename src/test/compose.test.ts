/**
 * Inline compose through the full loop: SPA store → port → background →
 * (fake) Thunderbird compose window → result toast back in the SPA.
 */
import { describe, expect, it } from "vitest";
import { settle, waitFor } from "./fakeMessenger";
import { boot, type Booted } from "./boot";
import { INBOX, personalMail, shapes } from "./fixtures";

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
        messageId: id,
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
    app.store().composeMessage(
      {
        kind: "draft",
        messageId: 42,
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
      args: [42, { to: ["Ann <ann@example.com>"], cc: [], identityId: "id2" }],
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
});
