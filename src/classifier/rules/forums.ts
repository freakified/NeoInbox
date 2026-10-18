/**
 * Discussion mail: mailing lists, group inboxes and forum software.
 *
 * Forums runs first among the category rules because nearly every list also
 * carries List-Unsubscribe — without precedence, all discussion mail would
 * collapse into Updates.
 */
import type { Features } from "../features";
import { domainMatches, hasAnyHeaderPrefix } from "../features";
import { isFinanceDomain } from "./finance";

const FORUM_DOMAINS = [
  // Group/list hosts.
  "googlegroups.com", "groups.io", "listserv.com", "freelists.org",
  "yahoogroups.com", "simplelists.com", "mailman3.com", "topicbox.com",
  "librelist.com", "lists.sourceforge.net", "lists.sr.ht",
  // Project lists that send from their own infrastructure. List hosts only:
  // the bare project domains also send donation receipts, conference
  // registrations and bug-tracker mail, and their lists carry List-* headers
  // that claim them anyway.
  "lists.debian.org", "lists.ubuntu.com", "lists.fedoraproject.org",
  "lists.freedesktop.org", "lists.linux.dev", "vger.kernel.org",
  "mail.python.org", "lists.apache.org", "lists.gnu.org", "lists.mozilla.org",
  "lists.openwall.com", "lists.w3.org", "ietf.org",
  // Forum platforms.
  "discoursemail.com", "discourse.org", "discourse.group",
  "flarum.org", "phpbb.com", "nodebb.org", "xenforo.com", "invisioncic.com",
  "stackexchange.com", "stackoverflow.email", "stackoverflow.com",
  "narkive.com",
];

/**
 * Headers written by list and forum software. These are the most reliable
 * signal in the whole classifier — a message carrying X-BeenThere went through
 * Mailman, full stop — and they cost nothing to check.
 */
export const FORUM_HEADER_PREFIXES = [
  "x-beenthere",
  "x-mailman",
  "x-list-",
  "x-listname",
  "x-listserver",
  "x-google-group-id",
  "x-discourse-",
  "x-topic-id",
  "x-forum-",
  "x-phpbb",
  "x-xenforo",
  "x-stackexchange",
];

/**
 * A List-Id pointing at a `lists.` host. Mailing lists are conventionally
 * hosted there, and newsletters — which set List-Id just as often — are not,
 * so this picks up lists that omit List-Post without dragging in every
 * marketing platform that stamps a List-Id.
 */
const LIST_HOST_RE = /(?:^|[.@<])lists?\./i;

export const matchesForums = (f: Features): boolean => {
  // Banks and agencies broadcast through list software (TreasuryDirect sends
  // from lists.fiscal.treasury.gov) but never host discussion; Finance owns them.
  if (isFinanceDomain(f.senderDomain)) return false;
  if (f.hasListPost || f.hasMailingList) return true;
  if (domainMatches(f.senderDomain, FORUM_DOMAINS)) return true;
  if (hasAnyHeaderPrefix(f, FORUM_HEADER_PREFIXES)) return true;
  if (f.listId && LIST_HOST_RE.test(f.listId)) return true;
  return false;
}
