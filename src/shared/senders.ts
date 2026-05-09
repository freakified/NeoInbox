const ADDR_RE = /<([^>]+)>/;

export interface ParsedSender {
  email: string;
  domain: string;
  localPart: string;
  name: string;
}

export const parseSender = (raw: string): ParsedSender => {
  const m = raw.match(ADDR_RE);
  const email = (m?.[1] ?? raw).trim().toLowerCase();
  const atIdx = email.lastIndexOf("@");
  return {
    email,
    domain: atIdx >= 0 ? email.slice(atIdx + 1) : "",
    localPart: atIdx >= 0 ? email.slice(0, atIdx) : "",
    name: m
      ? raw
          .slice(0, raw.indexOf("<"))
          .trim()
          .replace(/^"|"$/g, "")
      : "",
  };
};

export const labelFromDomain = (domain: string): string => {
  const significant = domain
    .split(".")
    .filter(Boolean)
    .at(-2) ?? domain;
  if (!significant) return "";
  return significant.charAt(0).toUpperCase() + significant.slice(1);
};
