import { useEffect } from "react";
import manifest from "../../../public/manifest.json";
import { REPO_URL, openExternal, openNewIssue } from "../lib/external";
import s from "./AboutDialog.module.css";

export const AboutDialog = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={s.scrim} onClick={onClose}>
      <div
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <img className={s.logo} src="icon.svg" alt="" />
        <h2 id="about-title" className={s.title}>NeoInbox</h2>
        <p className={s.version}>Version {manifest.version}</p>
        <p className={s.blurb}>
          The Google Inbox experience, reimplemented as a Thunderbird extension. Finally relive the glory days, with any email account!
        </p>
        <div className={s.links}>
          <button type="button" className={s.link} onClick={() => openExternal(REPO_URL)}>
            Source code
          </button>
          <button type="button" className={s.link} onClick={() => void openNewIssue("bug")}>
            Report a bug
          </button>
        </div>
        <p className={s.fine}>
          Free software under the Mozilla Public License 2.0.
        </p>
        <p className={s.fine}>
          Not affiliated with Google.
        </p>
        <button type="button" className={s.close} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};
