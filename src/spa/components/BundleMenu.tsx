import { useEffect, useRef, useState } from "react";
import type { Thread } from "../../shared/types";
import { BundleManagerModal } from "./BundleManagerModal";
import { Icon } from "./Icon";
import s from "./BundleMenu.module.css";

export const BundleMenu = ({
  thread,
  onTranslateToEnglish,
}: {
  thread: Thread;
  onTranslateToEnglish: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <div className={s.wrapper} ref={wrapperRef}>
      <button
        type="button"
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        className={s.trigger}
      >
        <Icon name="more_vert" className={s.triggerIcon} />
      </button>
      {menuOpen && (
        <div className={s.menu} role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={s.menuItem}
            role="menuitem"
            onClick={() => {
              onTranslateToEnglish();
              setMenuOpen(false);
            }}
          >
            <Icon name="translate" className={s.menuIcon} />
            <span>Translate to English</span>
          </button>
          <button
            type="button"
            className={s.menuItem}
            role="menuitem"
            onClick={() => {
              setSettingsOpen(true);
              setMenuOpen(false);
            }}
          >
            <Icon name="settings" className={s.menuIcon} />
            <span>Bundle settings</span>
          </button>
        </div>
      )}
      {settingsOpen && (
        <BundleManagerModal
          thread={thread}
          initialCategory={thread.category}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};
