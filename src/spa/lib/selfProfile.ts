import { useEffect, useState } from "react";
import { log } from "../../shared/log";
import { listIdentities } from "./identities";

/** What your own address-book card says about one of your addresses. */
export interface SelfProfile {
  name: string;
  /** An object URL for a card's photo, alive for the tab's lifetime. */
  photo: string | null;
}

const EMPTY: SelfProfile = { name: "", photo: null };

const cache = new Map<string, Promise<SelfProfile>>();

const cardHasEmail = (properties: messenger.contacts.ContactProperties, email: string): boolean =>
  [properties.PrimaryEmail, properties.SecondEmail].some((e) => e?.toLowerCase() === email) ||
  // Cards with more than two addresses only list the rest in the vCard.
  (properties.vCard ?? "")
    .split(/\r?\n/)
    .some((line) => /^(item\d+\.)?EMAIL[;:]/i.test(line) && line.slice(line.lastIndexOf(":") + 1).trim().toLowerCase() === email);

/**
 * Your cards for an address in Thunderbird's address books, minus remote
 * (LDAP) ones, which can't be yours. Searches with a plain string: the
 * QueryInfo form isn't dependable across Thunderbird versions.
 */
const cardsFor = async (email: string): Promise<messenger.contacts.ContactNode[]> =>
  (await messenger.contacts.quickSearch(email)).filter(
    (card) => !card.remote && cardHasEmail(card.properties, email),
  );

const photos = new Map<string, Promise<string | null>>();

const photoOf = (card: messenger.contacts.ContactNode): Promise<string | null> => {
  let pending = photos.get(card.id);
  if (!pending) {
    pending = messenger.contacts
      .getPhoto(card.id)
      .then((file) => (file ? URL.createObjectURL(file) : null))
      .catch(() => null);
    photos.set(card.id, pending);
  }
  return pending;
};

const firstPhoto = async (cards: messenger.contacts.ContactNode[]): Promise<string | null> => {
  for (const card of cards) {
    const photo = await photoOf(card);
    if (photo) return photo;
  }
  return null;
};

let anyOwnPhoto: Promise<string | null> | null = null;

/**
 * A photo from any card for any of your addresses. People often have a card
 * per address and only put a photo on one; every one of them is you.
 */
const ownPhoto = (): Promise<string | null> =>
  (anyOwnPhoto ??= listIdentities().then(async (identities) => {
    for (const email of new Set(identities.map((i) => i.email.toLowerCase()))) {
      const photo = await firstPhoto(await cardsFor(email));
      if (photo) return photo;
    }
    return null;
  }).catch(() => null));

/** Of several cards for the address, the first with a photo wins. */
const loadProfile = async (email: string): Promise<SelfProfile> => {
  if (!messenger.contacts?.quickSearch) return EMPTY;
  const cards = await cardsFor(email);
  const name = cards.map((card) => card.properties.DisplayName?.trim()).find(Boolean) ?? "";
  return { name, photo: (await firstPhoto(cards)) ?? (await ownPhoto()) };
};

export const profileFor = (email: string): Promise<SelfProfile> => {
  const key = email.toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = loadProfile(key).catch((e) => {
      log.warn("selfProfile", "couldn't search address books", e);
      cache.delete(key);
      return EMPTY;
    });
    cache.set(key, pending);
  }
  return pending;
};

/**
 * Your name and photo for one of your addresses, from your own cards in the
 * address book. Loads once per tab; card edits show up on reload.
 */
export const useSelfProfile = (email: string | null | undefined): SelfProfile => {
  const [profile, setProfile] = useState<{ email: string; profile: SelfProfile } | null>(null);
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    void profileFor(email).then((p) => {
      if (!cancelled) setProfile({ email, profile: p });
    });
    return () => {
      cancelled = true;
    };
  }, [email]);
  return email && profile?.email === email ? profile.profile : EMPTY;
};
