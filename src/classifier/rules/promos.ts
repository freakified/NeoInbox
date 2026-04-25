import type { Features } from "../features";

const PROMO_SUBJECT_RE =
  /(\d+%\s*off|\bsale\b|\bdeal\b|\bsave\b|limited[- ]time|new\s+arrival|exclusive|free\s+shipping|today\s+only|flash\s+sale|clearance|bogo|ends\s+(?:tonight|soon|today))/i;

export const matchesPromos = (f: Features): boolean => {
  if (!f.hasListUnsubscribe) return false;
  if (PROMO_SUBJECT_RE.test(f.subject)) return true;
  return false;
}
