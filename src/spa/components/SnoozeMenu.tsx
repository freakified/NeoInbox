import { useEffect, useRef, useState } from "react";
import { snoozePresets } from "../lib/snoozePresets";
import { Icon } from "./Icon";

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
    <div ref={ref} className="relative">
      <button
        title="Snooze"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="p-1.5 rounded-full hover:bg-neutral-100 leading-none"
      >
        <Icon name="snooze" className="text-lg text-neutral-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-white shadow-elevation-2 rounded border border-md-divider py-1 min-w-36">
          {snoozePresets().map(({ label, wakeAt }) => (
            <button
              key={label}
              className="w-full text-left text-sm px-3 py-1.5 hover:bg-neutral-50"
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
}
