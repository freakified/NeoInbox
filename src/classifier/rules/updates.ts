import type { Features } from "../features";

export function matchesUpdates(f: Features): boolean {
  if (f.hasListUnsubscribe) return true;
  if (
    /^(no-?reply|noreply|notifications?|donotreply|do-not-reply|auto|automated|mailer-daemon|postmaster)/.test(
      f.senderLocalPart,
    )
  ) {
    return true;
  }
  return false;
}
