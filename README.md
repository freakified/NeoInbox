# NeoInbox

Google Inbox died in 2019. NeoInbox brings its reading experience back as a
Thunderbird MailExtension — auto-bundles, trip bundles, pin/snooze/done, and a
single smooth list that expands in place instead of throwing you into a
three-pane layout.

It works against any IMAP account Thunderbird can talk to. Nothing about it is
Gmail-specific.

## What it does

- **Bundles.** Mail is grouped into Travel, Finance, Purchases, Social, Updates,
  Promos and Forums by a local rules engine, then collapsed into one row per
  bundle. You can add your own bundles and rules, and correct any message's
  bundle from its row.
- **Trips.** Flight, hotel and rental confirmations get clustered into a single
  trip bundle by date and PNR, with the trip's date range on the row.
- **Pin, snooze, done.** The Inbox verbs. Sweep a whole section done in one
  click; pinned threads survive the sweep.
- **Reminders.** Free-standing rows in the stream that aren't backed by mail.
- **In-place expansion.** Opening a conversation expands it inside the list
  rather than replacing the view.

## Privacy

This is a mail client, so it's worth being precise:

- **Classification is local.** Bundling is a heuristic rules engine that runs in
  the extension. No message content is uploaded to classify it, and there is no
  telemetry, analytics or crash reporting of any kind.
- **Bundle state stays in NeoInbox.** Categories live in a local IndexedDB
  cache, not in tags on the server, so NeoInbox does not litter your mailbox for
  every other client that reads it. Pin and snooze use small NeoInbox tags,
  because that state has to survive a reinstall.
- **Remote content is blocked by default.** Message bodies render in a sandboxed
  iframe under a `default-src 'none'` CSP, so tracking pixels, remote
  stylesheets, webfonts, nested frames and `<object>` embeds are all inert until
  you allow images — per message, or per sender.
- **One outbound request exists in the entire codebase**, in
  `src/spa/lib/translation.ts`. It is the optional translate-message feature, it
  is off until you enter your own provider and key in Settings, and you can
  point it at a LibreTranslate instance or a local OpenAI-compatible model
  instead of a cloud API.

## Keyboard shortcuts

Press <kbd>?</kbd> in the app for the full list.

| Key | Action |
| --- | --- |
| <kbd>j</kbd> / <kbd>k</kbd> | Next / previous conversation |
| <kbd>Enter</kbd> | Open or close |
| <kbd>Esc</kbd> | Close the open conversation |
| <kbd>e</kbd> | Done |
| <kbd>s</kbd> | Snooze until tomorrow |
| <kbd>p</kbd> | Pin / unpin |
| <kbd>#</kbd> | Trash (when delete actions are enabled) |
| <kbd>g</kbd> then <kbd>i</kbd>/<kbd>s</kbd>/<kbd>d</kbd>/<kbd>t</kbd>/<kbd>r</kbd> | Go to Inbox / Snoozed / Done / Trips / Reminders |

## Install

Requires Thunderbird 115 or newer.

```sh
npm install
npm run build
```

That produces `dist/`, an unpacked MailExtension.

1. **Tools → Developer Tools → Debug Add-ons** (the `about:debugging` route is
   under "this-thunderbird").
2. **Load Temporary Add-on…**, and pick `dist/manifest.json`.
3. Click the **Open NeoInbox** toolbar button.

On first run the background script backfills and classifies up to 500 recent
inbox messages; the header shows the progress.

## Development

```sh
npm run dev        # vite build --watch
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

After a rebuild, hit **Reload** next to the extension in Debug Add-ons.

Layout:

| Path | What lives there |
| --- | --- |
| `src/background/` | Backfill, incremental sync, snooze alarms, trip scanning |
| `src/classifier/` | Bundle rules and the feature extractors they run on |
| `src/shared/` | Threading, trip clustering, types shared across both sides |
| `src/spa/` | The React UI rendered in the NeoInbox tab |
| `src/store/` | Zustand store and the Dexie/IndexedDB cache |

## Known sharp edges

- Bundling is heuristic. Airline promos landing in Travel is the classic
  failure; rules live in `src/classifier/rules/` and are easy to extend, and you
  can correct any message from its row.
- Trip extraction has been exercised against a limited set of real
  confirmations. Unusual airlines and hotel chains will need parser work.
- Backfill is capped at 500 messages and only covers inbox folders.
- Trash, Spam and Contacts are placeholders in the drawer.
- Inline `cid:` images in message bodies don't render yet.

## License

[MPL-2.0](LICENSE).
