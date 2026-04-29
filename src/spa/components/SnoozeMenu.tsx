import { useEffect, useRef, useState } from "react";
import { snoozePresets } from "../lib/snoozePresets";
import { Icon } from "./Icon";
import s from "./SnoozeMenu.module.css";

export const SnoozeMenu = ({
  onChoose,
}: {
  onChoose: (wakeAt: number) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className={s.wrapper}>
      <button
        title="Snooze"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={s.trigger}
      >
        <Icon name="snooze" className={s.triggerIcon} />
      </button>
      {open && (
        <div className={s.dropdown}>
          {snoozePresets().map(({ label, wakeAt }) => (
            <button
              key={label}
              className={s.option}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onChoose(wakeAt);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
