import type { RawMessage } from "../../shared/types";

export function ReplyFooter({ latest }: { latest: RawMessage }) {
  const onReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    void messenger.compose.beginReply(latest.id, "replyToAll");
  };
  const onForward = (e: React.MouseEvent) => {
    e.stopPropagation();
    void messenger.compose.beginForward(latest.id);
  };

  return (
    <div className="flex gap-2 px-5 py-3 border-t border-neutral-200 bg-neutral-50">
      <button
        onClick={onReply}
        className="px-4 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-sm text-neutral-700"
      >
        Reply
      </button>
      <button
        onClick={onForward}
        className="px-4 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-sm text-neutral-700"
      >
        Forward
      </button>
    </div>
  );
}
