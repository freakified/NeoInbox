const TRUSTED_SENDERS_KEY = "neoinbox.trustedImageSenders";
const TRUSTED_SENDERS_EVENT = "neoinbox:trusted-image-senders";

const parseTrustedSenders = (raw: string | null): Set<string> => {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase()),
    );
  } catch {
    return new Set();
  }
};

export const getTrustedImageSenders = (): Set<string> =>
  parseTrustedSenders(localStorage.getItem(TRUSTED_SENDERS_KEY));

export const isTrustedImageSender = (email: string): boolean =>
  getTrustedImageSenders().has(email.toLowerCase());

export const trustImageSender = (email: string): void => {
  const normalized = email.toLowerCase();
  if (!normalized) return;
  const senders = getTrustedImageSenders();
  senders.add(normalized);
  localStorage.setItem(TRUSTED_SENDERS_KEY, JSON.stringify([...senders].sort()));
  window.dispatchEvent(new Event(TRUSTED_SENDERS_EVENT));
};

export const subscribeTrustedImageSenders = (callback: () => void): (() => void) => {
  const onChange = () => callback();
  window.addEventListener(TRUSTED_SENDERS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TRUSTED_SENDERS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};
