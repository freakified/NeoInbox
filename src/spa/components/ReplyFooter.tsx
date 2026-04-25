import type { RawMessage } from "../../shared/types";
import { Icon } from "./Icon";

export const ReplyFooter = ({ latest }: { latest: RawMessage }) => {
  const onReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    void messenger.compose.beginReply(latest.id, "replyToAll");
  };
  const onForward = (e: React.MouseEvent) => {
    e.stopPropagation();
    void messenger.compose.beginForward(latest.id);
  };

  return (
    <div className="flex gap-2 px-5 py-3 border-t border-md-divider bg-neutral-50">
      <button
        onClick={onReply}
        className="flex items-center gap-1.5 px-4 py-1.5 rounded border border-md-divider bg-white hover:bg-neutral-100 text-sm text-md-on-surface"
      >
        <Icon name="reply" className="text-base text-md-secondary-text" />
        Reply
      </button>
      <button
        onClick={onForward}
        className="flex items-center gap-1.5 px-4 py-1.5 rounded border border-md-divider bg-white hover:bg-neutral-100 text-sm text-md-on-surface"
      >
        <Icon name="forward" className="text-base text-md-secondary-text" />
        Forward
      </button>
    </div>
  );
}
