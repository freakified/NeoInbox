import type { ReactNode } from "react";
import { useSelfProfile } from "../lib/selfProfile";
import s from "./SelfPhoto.module.css";

/**
 * Fills an avatar circle with your address-book photo for `email`, one of
 * your own addresses; without one (or for anyone else's, `email` null) it
 * shows `children`, the initial.
 */
export const SelfPhoto = ({ email, children }: { email: string | null | undefined; children: ReactNode }) => {
  const { photo } = useSelfProfile(email);
  return photo ? <img className={s.photo} src={photo} alt="" /> : <>{children}</>;
};
