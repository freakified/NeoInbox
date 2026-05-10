# NeoInbox

A Thunderbird MailExtension that brings back the Google Inbox experience —
auto-bundles, trip bundles, inline highlights, pin/snooze/done, and a single
smooth list that expands in place.

Status: **M2** — auto-classification into 7 bundles (Travel, Finance, Purchases, Social, Updates, Promos, Forums) via local heuristics stored in NeoInbox's local cache. See `/Users/dan/.claude/plans/remember-google-inbox-i-reactive-otter.md`.

## Build

```sh
npm install
npm run build
```

This produces `dist/` — an unpacked Thunderbird MailExtension.

## Load in Thunderbird for development

1. Open Thunderbird (tested against 115 ESR and 128 ESR).
2. Menu → Tools → **Developer Tools** → **Debug Add-ons** (or visit `about:debugging#/runtime/this-firefox` via a temporarily opened tab — in Thunderbird the route is under "this-thunderbird").
3. Click **Load Temporary Add-on…**.
4. Select `dist/manifest.json`.
5. A new toolbar button titled "Open NeoInbox" appears. Click it → the NeoInbox tab opens and lists your inbox messages.

To iterate: `npm run dev` (watch mode). After a rebuild, click the **Reload** button next to the extension in Debug Add-ons.

## M1 verification checklist

- [x] Toolbar button appears after loading.
- [x] Clicking the button opens a new tab titled "NeoInbox".
- [x] The tab shows up to 500 recent messages across all inbox folders.
- [x] Unread messages render in bold.
- [x] Receiving new mail in Thunderbird logs a line in the background script console.

## M2 verification checklist

First install: on reload, the background script auto-runs a one-time backfill of up to 500 inbox messages. Expect a log line like `[NeoInbox] backfill: N/M classified`.

- [ ] The NeoInbox tab now shows collapsed **bundle sections** (Travel, Finance, Purchases, Social, Updates, Promos, Forums) when those categories have messages.
- [ ] Uncategorised messages appear below, in the "Inbox" section (always expanded).
- [ ] Clicking a bundle toggles its expansion.
- [ ] The **Re-classify** button re-runs the backfill (visible in bg-script console).
- [ ] Open the Thunderbird native 3-pane view and confirm that bundle classification stays private to NeoInbox; no `neoinbox-*` bundle tags are added to messages.

**Known v1 sharp edges** (see plan § Known risks):

- Rules are heuristic; expect some misclassifications (e.g., airline promos → travel). The rules files are in `src/classifier/rules/` — easy to extend.
- Backfill is capped at 500 messages and only processes inbox folders. Deeper backfill / reprocessing is a later milestone.
- Bundle categories are stored in NeoInbox's local IndexedDB cache. Pin and snooze still use small NeoInbox tags for Thunderbird-visible state.
