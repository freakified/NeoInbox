import { useEffect, useState } from "react";
import { log } from "../../shared/log";
import { listIdentities } from "./identities";

type Card = messenger.contacts.ContactNode;

/** What the address book says about an address. */
export interface ContactProfile {
  name: string;
  /** An object URL for a card's photo, alive for the tab's lifetime. */
  photo: string | null;
}

const EMPTY: ContactProfile = { name: "", photo: null };

/** Every address on a card: two named fields, the rest only in the vCard. */
const cardEmails = (properties: messenger.contacts.ContactProperties): string[] => [
  ...[properties.PrimaryEmail, properties.SecondEmail].flatMap((e) => (e ? [e] : [])),
  ...(properties.vCard ?? "")
    .split(/\r?\n/)
    .filter((line) => /^(item\d+\.)?EMAIL[;:]/i.test(line))
    .map((line) => line.slice(line.lastIndexOf(":") + 1)),
].map((e) => e.trim().toLowerCase());

let index: Promise<Map<string, Card[]>> | null = null;

/**
 * Cards in Thunderbird's local address books (CardDAV ones included), by
 * every address on them. One read per tab beats a search per sender, and
 * remote (LDAP) directories can't be listed, only searched.
 */
const cardIndex = (): Promise<Map<string, Card[]>> =>
  (index ??= (async () => {
    const byEmail = new Map<string, Card[]>();
    if (!messenger.addressBooks?.list) return byEmail;
    for (const book of await messenger.addressBooks.list(true)) {
      if (book.remote) continue;
      for (const card of book.contacts ?? []) {
        for (const email of new Set(cardEmails(card.properties))) {
          byEmail.set(email, [...(byEmail.get(email) ?? []), card]);
        }
      }
    }
    return byEmail;
  })().catch((e) => {
    log.warn("contactCards", "couldn't read address books", e);
    index = null;
    return new Map<string, Card[]>();
  }));

const photos = new Map<string, Promise<string | null>>();

const photoOf = (card: Card): Promise<string | null> => {
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

const firstPhoto = async (cards: readonly Card[]): Promise<string | null> => {
  for (const card of cards) {
    const photo = await photoOf(card);
    if (photo) return photo;
  }
  return null;
};

const profiles = new Map<string, Promise<ContactProfile>>();

/** Of several cards for the address, the first with a photo wins. */
export const contactFor = (email: string): Promise<ContactProfile> => {
  const key = email.toLowerCase();
  let pending = profiles.get(key);
  if (!pending) {
    pending = cardIndex().then(async (byEmail) => {
      const cards = byEmail.get(key) ?? [];
      if (!cards.length) return EMPTY;
      const name = cards.map((card) => card.properties.DisplayName?.trim()).find(Boolean) ?? "";
      return { name, photo: await firstPhoto(cards) };
    });
    profiles.set(key, pending);
  }
  return pending;
};

let anyOwnPhoto: Promise<string | null> | null = null;

/**
 * A photo from any card for any of your addresses. Thunderbird shows cards
 * that share an address as one, so a photo on any of yours is your photo.
 */
const ownPhoto = (): Promise<string | null> =>
  (anyOwnPhoto ??= listIdentities().then(async (identities) => {
    for (const email of new Set(identities.map((i) => i.email.toLowerCase()))) {
      const { photo } = await contactFor(email);
      if (photo) return photo;
    }
    return null;
  }));

/** Your name and photo for one of your own addresses. */
export const selfProfileFor = async (email: string): Promise<ContactProfile> => {
  const profile = await contactFor(email);
  return profile.photo ? profile : { ...profile, photo: await ownPhoto() };
};

export const useProfile = (
  email: string | null | undefined,
  load: (email: string) => Promise<ContactProfile>,
): ContactProfile => {
  const [loaded, setLoaded] = useState<{ email: string; profile: ContactProfile } | null>(null);
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    void load(email).then((profile) => {
      if (!cancelled) setLoaded({ email, profile });
    });
    return () => {
      cancelled = true;
    };
  }, [email, load]);
  return email && loaded?.email === email ? loaded.profile : EMPTY;
};

/**
 * Name and photo for anyone's address from the address book. Loads once per
 * tab; card edits show up on reload.
 */
export const useContact = (email: string | null | undefined): ContactProfile =>
  useProfile(email, contactFor);

/** Like useContact, for your own addresses: falls back to your other cards' photo. */
export const useSelfProfile = (email: string | null | undefined): ContactProfile =>
  useProfile(email, selfProfileFor);
