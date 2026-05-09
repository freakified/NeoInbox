import { useState } from "react";
import type { Thread } from "../../shared/types";
import { BundleManagerModal } from "./BundleManagerModal";
import { Icon } from "./Icon";
import s from "./BundleMenu.module.css";

export const BundleMenu = ({ thread }: { thread: Thread }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={s.wrapper}>
      <button
        type="button"
        title="Bundle actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={s.trigger}
      >
        <Icon name="more_vert" className={s.triggerIcon} />
      </button>
      {open && (
        <BundleManagerModal
          thread={thread}
          initialCategory={thread.category}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};
