const ADDR_RE = /<([^>]+)>/;
const PLACEHOLDER_NAME_RE = /^(?:undefined|null)(?:\s+(?:undefined|null))*$/i;

export interface ParsedSender {
  email: string;
  domain: string;
  localPart: string;
  name: string;
}

const cleanAddressValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const cleanDisplayName = (value: string): string => {
  const name = value.trim().replace(/^"|"$/g, "");
  return PLACEHOLDER_NAME_RE.test(name) ? "" : name;
};

export const parseSender = (raw: string): ParsedSender => {
  const value = cleanAddressValue(raw);
  if (!value || PLACEHOLDER_NAME_RE.test(value)) {
    return {
      email: "",
      domain: "",
      localPart: "",
      name: "",
    };
  }

  const m = value.match(ADDR_RE);
  const email = (m?.[1] ?? value).trim().toLowerCase();
  const atIdx = email.lastIndexOf("@");
  return {
    email,
    domain: atIdx >= 0 ? email.slice(atIdx + 1) : "",
    localPart: atIdx >= 0 ? email.slice(0, atIdx) : "",
    name: m
      ? cleanDisplayName(value.slice(0, value.indexOf("<")))
      : "",
  };
};

export const parseAddressList = (raw: unknown): string[] => {
  const value = cleanAddressValue(raw);
  if (!value || PLACEHOLDER_NAME_RE.test(value)) return [];

  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  let inAngle = false;
  let escaping = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\" && inQuote) {
      escaping = true;
      continue;
    }
    if (ch === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && ch === "<") {
      inAngle = true;
      continue;
    }
    if (!inQuote && ch === ">") {
      inAngle = false;
      continue;
    }
    if (!inQuote && !inAngle && ch === ",") {
      const item = value.slice(start, i).trim();
      if (item && !PLACEHOLDER_NAME_RE.test(item)) out.push(item);
      start = i + 1;
    }
  }

  const item = value.slice(start).trim();
  if (item && !PLACEHOLDER_NAME_RE.test(item)) out.push(item);
  return out;
};

export const labelFromDomain = (domain: string): string => {
  const significant = domain
    .split(".")
    .filter(Boolean)
    .at(-2) ?? domain;
  if (!significant) return "";
  return significant.charAt(0).toUpperCase() + significant.slice(1);
};
