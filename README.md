# NeoInbox

Google Inbox, rebuilt as a Thunderbird MailExtension. It works with any IMAP
account Thunderbird can use.

- **Bundles**: Finance, Purchases, Social, Updates, Promos and Forums, sorted
  by a local rules classifier. You can also add your own bundles.
- **Trips**: flight, hotel and rental confirmations grouped into one trip.
- **Pin, snooze, done**, plus reminders, and conversations that expand in place.

Classification runs entirely in the extension, and there's no telemetry.
The only network request NeoInbox makes is for the optional translate
feature, and only after you set it up with your own provider.

Press <kbd>?</kbd> in the app to see the keyboard shortcuts.

## Install

Requires Thunderbird 128+.

```sh
pnpm install
pnpm build
```

In Thunderbird, go to **Tools → Developer Tools → Debug Add-ons → Load
Temporary Add-on…** and pick `dist/manifest.json`. Then click **Open NeoInbox**
in the toolbar.

## Development

```sh
pnpm dev         # rebuild on change, then hit Reload in Debug Add-ons
pnpm test
pnpm typecheck
pnpm harness     # run the UI in a browser against a fake Thunderbird: http://localhost:5199/dev.html
pnpm shot        # headless screenshot of the harness, see scripts/shot.mjs
pnpm site        # the website (landing page + live demo): http://localhost:5200
pnpm build:site  # build the website into dist-site/ (CI deploys it to Cloudflare Pages)
pnpm eval        # trip-extraction eval against real-mail fixtures
```

| Path | Contents |
| --- | --- |
| `src/background/` | Sync, backfill, snooze alarms, trip scanning |
| `src/classifier/` | Bundle rules and feature extractors |
| `src/shared/` | Threading, trip clustering, shared types |
| `src/spa/` | React UI shown in the NeoInbox tab |
| `src/store/` | Zustand store and IndexedDB (Dexie) cache |
| `src/dev/` | Browser harness, dev seed and demo mailbox |
| `site/` | The website: landing page and live demo |

## License

[MPL-2.0](LICENSE)
