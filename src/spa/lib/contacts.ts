import { useMemo } from "react";
import { addressEmail } from "../../shared/compose";
import { useMailStore } from "../../store/mailStore";

/**
 * Everyone you've written to or heard from in cached mail, most frequent
 * first, as "Name <email>" strings — the recipient field's and the search
 * box's suggestions. A walk of every cached message, so a caller that only
 * sometimes shows them passes `enabled` to skip it the rest of the time.
 */
export const useKnownContacts = (limit = 300, enabled = true): string[] => {
  const messagesByKey = useMailStore((st) => st.messagesByKey);
  const myEmails = useMailStore((st) => st.myEmails);
  return useMemo(() => {
    if (!enabled) return [];
    const counts = new Map<string, { raw: string; count: number }>();
    const add = (raw: string, weight: number) => {
      const email = addressEmail(raw);
      if (!email.includes("@") || myEmails.has(email)) return;
      const entry = counts.get(email);
      if (entry) {
        entry.count += weight;
        // Prefer a form with a display name over a bare address.
        if (!entry.raw.includes("<") && raw.includes("<")) entry.raw = raw;
      } else {
        counts.set(email, { raw, count: weight });
      }
    };
    for (const m of Object.values(messagesByKey)) {
      if (m.origin === "sent") {
        for (const raw of [...m.recipients, ...m.ccList]) add(raw, 3);
      } else if (m.origin === "inbox" && (m.category === "personal" || m.category === null)) {
        add(m.author, 1);
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((entry) => entry.raw);
  }, [messagesByKey, myEmails, limit, enabled]);
};
