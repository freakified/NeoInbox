/**
 * Everything else a machine sent you: notifications, receipts for your
 * attention rather than your wallet, newsletters, alerts, service notices.
 *
 * Updates is the last rule in the pipeline and the widest by design. Anything
 * it declines stays loose in the inbox, so the question it asks is not "is
 * this an update?" but "is there any evidence a person did not write this?".
 */
import type { Features } from "../features";
import { domainMatches, hasAnyHeaderPrefix } from "../features";
import { isBulk, MACHINE_SENDER_RE, ROLE_SENDER_RE } from "../signals";

/**
 * Services whose mail is notifications almost by definition. These exist so a
 * message with no bulk headers, an opaque local part and a subject nobody
 * could pattern-match still lands somewhere — `a7fk2@mail.notion.so` is a
 * notification, and nothing but the domain says so.
 */
const SERVICE_DOMAINS = [
  // Accounts and platforms. Consumer webmail domains (gmail.com, icloud.com,
  // proton.me …) are absent even though those providers send account mail of
  // their own: they are where people write from, and matchesPersonal claims
  // them first for exactly that reason. Their notices are machine-sent and are
  // picked up by the sender and bulk tests instead.
  "google.com", "accounts.google.com", "gsuite.google.com",
  "microsoft.com", "microsoftonline.com", "office.com",
  "apple.com", "mozilla.org",
  // Developer and IT.
  "github.com", "gitlab.com", "bitbucket.org", "atlassian.com",
  "atlassian.net", "jira.com", "sourcegraph.com", "circleci.com",
  "travis-ci.org", "npmjs.com", "pypi.org", "docker.com", "jetbrains.com",
  "sentry.io", "datadoghq.com", "pagerduty.com", "statuspage.io",
  "cloudflare.com", "digitalocean.com", "linode.com", "vultr.com",
  "heroku.com", "netlify.com", "vercel.com", "render.com", "fly.io",
  "amazonaws.com", "aws.amazon.com", "azure.com", "cloud.google.com",
  "namecheap.com", "godaddy.com", "gandi.net", "hover.com", "porkbun.com",
  "dnsimple.com", "hetzner.com", "ovh.com", "dreamhost.com", "bluehost.com",
  // Work and productivity.
  "notion.so", "figma.com", "zoom.us", "dropbox.com", "box.com",
  "asana.com", "trello.com", "monday.com", "clickup.com", "linear.app",
  "airtable.com", "basecamp.com", "smartsheet.com", "miro.com", "loom.com",
  "calendly.com", "docusign.net", "docusign.com", "hellosign.com",
  "adobe.com", "canva.com", "grammarly.com", "evernote.com", "todoist.com",
  "zendesk.com", "freshdesk.com", "intercom.io", "helpscout.com",
  "surveymonkey.com", "typeform.com", "mailchimp.com", "squarespace.com",
  "wix.com", "webflow.com", "wordpress.com", "ghost.org",
  // Identity and security.
  "okta.com", "auth0.com", "duosecurity.com", "1password.com",
  "lastpass.com", "bitwarden.com", "dashlane.com", "haveibeenpwned.com",
  "yubico.com",
  // Newsletters and reading.
  "substack.com", "buttondown.email", "beehiiv.com", "convertkit.com",
  "revue.email", "tinyletter.com", "feedly.com", "pocket.co",
  // Media subscriptions and streaming.
  "netflix.com", "hulu.com", "disneyplus.com", "max.com", "hbomax.com",
  "paramountplus.com", "peacocktv.com", "primevideo.com", "crunchyroll.com",
  "audible.com", "kindle.com",
  // Telecom and utilities.
  "verizon.com", "verizonwireless.com", "att.com", "t-mobile.com",
  "sprint.com", "mintmobile.com", "googlefi.com", "visible.com",
  "comcast.com", "xfinity.com", "spectrum.com", "cox.com", "centurylink.com",
  "frontier.com", "optimum.com", "vodafone.com", "o2.co.uk", "ee.co.uk",
  "three.co.uk", "bt.com", "sky.com", "virginmedia.com",
  // Health, government and education (mail that is notices, not money).
  "kaiserpermanente.org", "myuhc.com", "uhc.com", "aetna.com", "cigna.com",
  "anthem.com", "bcbs.com", "humana.com", "cvsspecialty.com", "labcorp.com",
  "questdiagnostics.com", "zocdoc.com", "mychart.com", "teladoc.com",
  "ssa.gov", "usa.gov", "dmv.ca.gov", "uscis.gov", "state.gov",
  "usajobs.gov", "collegeboard.org", "commonapp.org", "coursera.org",
  "edx.org", "udemy.com", "khanacademy.org", "canvaslms.com",
  "instructure.com", "blackboard.com", "gradescope.com",
  // Jobs.
  "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com",
  "greenhouse.io", "lever.co", "workable.com", "ashbyhq.com",
];

/** Vendor headers from services whose notifications are Updates. */
export const SERVICE_HEADER_PREFIXES = [
  "x-github-",
  "x-gitlab-",
  "x-jira-",
  "x-atlassian-",
  "x-launchpad-",
  "x-zendesk",
  "x-freshdesk",
  "x-intercom",
  "x-notion",
  "x-asana",
  "x-trello",
  "x-google-appengine",
  "x-ms-exchange-organization-authas",
  "x-auto-response-suppress",
];

/**
 * Subjects that describe a service acting on your account. Used only to let a
 * shared role mailbox claim mail mid-thread — on its own, none of this is
 * enough to bundle anything.
 */
const TRANSACTIONAL_SUBJECT_RE =
  /\b(verification|verify|confirm\s+your|activate|activation|password|passcode|one[- ]time|2fa|two[- ]factor|security\s+(?:alert|code)|sign[- ]?in|log\s?in|new\s+device|unusual\s+activity|suspicious|account\s+(?:update|created|closed|suspended|locked)|terms|privacy\s+policy|policy\s+update|maintenance|downtime|scheduled|outage|incident|status\s+update|action\s+required|expir(?:es|ing|ed)|renew(?:al|ing|s)?|subscription|trial|welcome\s+to|getting\s+started|invitation|invited\s+you|has\s+(?:been|shared)|assigned\s+to\s+you|mentioned\s+you|commented|ticket\s*#|case\s*#|request\s+(?:received|approved|denied)|appointment|reminder|survey|feedback|webinar|digest|weekly\s+(?:summary|report|digest)|monthly\s+(?:summary|report|statement)|release\s+notes|what'?s\s+new|now\s+available|update\s+available)\b/i;

export const matchesUpdates = (f: Features): boolean => {
  // Bulk in any of its forms: List-Unsubscribe, Precedence, or a campaign
  // platform's fingerprint.
  if (isBulk(f)) return true;
  if (f.autoSubmitted) return true;
  if (MACHINE_SENDER_RE.test(f.senderLocalPart)) return true;
  if (domainMatches(f.senderDomain, SERVICE_DOMAINS)) return true;
  if (hasAnyHeaderPrefix(f, SERVICE_HEADER_PREFIXES)) return true;

  if (ROLE_SENDER_RE.test(f.senderLocalPart)) {
    // A shared mailbox mid-conversation is a conversation — a support thread
    // you are actually in must not be bundled away. Fresh one-way mail from
    // the same mailbox is exactly what Updates is for.
    if (!f.isReply) return true;
    return TRANSACTIONAL_SUBJECT_RE.test(f.subject);
  }

  return false;
}
