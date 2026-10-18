/**
 * Stable identity for NeoInbox-local per-message state (pins, resurfacing,
 * trip membership): the Message-ID header, which survives folder moves where
 * the row key does not. Messages without one fall back to the row key.
 */
export const pinKeyOf = (m: { headerMessageId: string; key: string }): string =>
  m.headerMessageId || m.key;
