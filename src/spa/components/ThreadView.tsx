import { useMemo, useState } from "react";
import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import { InlineMessage } from "./InlineMessage";
import { ReplyFooter } from "./ReplyFooter";

export const ThreadView = ({
  thread: t,
  accentColor,
}: {
  thread: Thread;
  accentColor?: string;
}) => {
  const doneThread = useMailStore((s) => s.doneThread);
  const trashThread = useMailStore((s) => s.trashThread);

  const latestInbox = useMemo(() => {
    const inbox = t.messages.filter((m) => m.origin === "inbox");
    return inbox[inbox.length - 1] ?? t.messages[t.messages.length - 1];
  }, [t]);

  const [openIds, setOpenIds] = useState<Set<number>>(
    () => new Set(latestInbox ? [latestInbox.id] : []),
  );

  if (!latestInbox) return null;

  const toggleMsg = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDone = () =>
    doneThread(
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
    );
  const onTrash = () => trashThread(t.messages.map((m) => m.id));

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4 border-b border-md-divider bg-white">
        <h2 className="text-lg font-medium text-md-on-surface truncate">
          {t.subject || "(no subject)"}
        </h2>
        <div className="shrink-0 ml-3 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDone();
            }}
            title="Archive thread"
            className="p-1.5 rounded-full text-md-secondary-text hover:text-md-on-surface hover:bg-neutral-100"
          >
            <Icon name="archive" className="text-xl" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrash();
            }}
            title="Move thread to trash"
            className="p-1.5 rounded-full text-md-secondary-text hover:text-md-on-surface hover:bg-neutral-100"
          >
            <Icon name="delete" className="text-xl" />
          </button>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-md-divider">
        {t.messages.map((m) => (
          <InlineMessage
            key={m.id}
            message={m}
            accentColor={accentColor}
            isOpen={openIds.has(m.id)}
            onToggle={() => toggleMsg(m.id)}
          />
        ))}
      </div>

      <ReplyFooter latest={latestInbox} />
    </div>
  );
}
