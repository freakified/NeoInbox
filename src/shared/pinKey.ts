/**
 * Stable identity for NeoInbox-local per-message state. The Message-ID
 * header survives folder moves and Thunderbird's id renumbering; messages
 * without one fall back to the numeric id.
 */
export const pinKeyOf = (m: { headerMessageId: string; id: number }): string =>
  m.headerMessageId || `msgid:${m.id}`;
