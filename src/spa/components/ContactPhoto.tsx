import type { ReactNode } from "react";
import { addressEmail } from "../../shared/compose";
import { useMailStore } from "../../store/mailStore";
import { contactFor, selfProfileFor, useProfile } from "../lib/contactCards";
import s from "./ContactPhoto.module.css";

/**
 * Fills an avatar circle with the address-book photo for `address` (a bare
 * email or "Name <email>"); without one it shows `children`, the initial.
 * Your own addresses use any of your cards' photos; `self` says it's yours
 * before the background has sent your addresses.
 */
export const ContactPhoto = ({
  address,
  self = false,
  children,
}: {
  address: string | null | undefined;
  self?: boolean;
  children: ReactNode;
}) => {
  const email = address ? addressEmail(address) : "";
  const mine = useMailStore((st) => self || st.myEmails.has(email));
  const { photo } = useProfile(email || null, mine ? selfProfileFor : contactFor);
  return photo ? <img className={s.photo} src={photo} alt="" /> : <>{children}</>;
};
