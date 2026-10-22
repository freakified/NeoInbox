# NeoInbox Privacy Policy

NeoInbox has no servers and doesn't collect, track or report anything. It has no analytics and no telemetry, and the developer never receives any data from it.

## Data stored on your computer

To show your mail as bundles, trips, package cards and so on, NeoInbox keeps a local cache in Thunderbird's extension storage. The cache holds message headers and bodies, the bundle each message was sorted into, and your settings. Messages are sorted by rules that run on your own computer. This data never leaves your computer, and removing the add-on deletes it.

## Translation (optional, off by default)

NeoInbox can translate a message when you click _Translate_ on that message. It never translates anything on its own. Before you can use translation, you have to pick a translation service in Settings and enter your own account details, such as an API key, for that service. You can pick:

- DeepL
- Google Cloud Translation
- Azure Translator
- LibreTranslate
- An OpenAI-compatible service
- A server address you enter yourself

When you translate a message, NeoInbox sends that message's subject and body text straight from your computer to the service you chose, along with your API key. Nothing goes through the developer. That service's own privacy policy then covers the text you send. Translations are cached on your computer for 3 days and then deleted. Your API key is stored only in Thunderbird's local storage.

NeoInbox has no internet access when you install it. The first time you use translation, Thunderbird asks your permission to contact your chosen service's address, and NeoInbox only gets access to that one address.

## Other network activity

- **Remote images:** If a message contains images hosted on the web and your Remote images setting allows them, they load from the sender's servers, as they do in any mail client. By default, remote images only load from senders you've marked as trusted.
- **Package tracking links:** Clicking one opens the carrier's tracking page in your browser.

## Contact

Questions: [github.com/freakified/NeoInbox/issues](https://github.com/freakified/NeoInbox/issues)
