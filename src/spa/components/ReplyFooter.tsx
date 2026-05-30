import type { RawMessage } from "../../shared/types";
import { Icon } from "./Icon";
import s from "./ReplyFooter.module.css";

export const ReplyFooter = ({
  replyTarget,
  draft,
}: {
  replyTarget?: RawMessage;
  draft?: RawMessage;
}) => {
  if (!replyTarget && !draft) return null;

  const onResumeDraft = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!draft) return;
    void messenger.compose.beginNew(draft.id);
  };
  const onReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!replyTarget) return;
    void messenger.compose.beginReply(replyTarget.id, "replyToAll");
  };
  const onForward = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!replyTarget) return;
    void messenger.compose.beginForward(replyTarget.id);
  };

  return (
    <div className={s.footer}>
      {draft && (
        <button onClick={onResumeDraft} className={s.btn}>
          <Icon name="edit" className={s.btnIcon} />
          Resume draft
        </button>
      )}
      {replyTarget && (
        <>
          <button onClick={onReply} className={s.btn}>
            <Icon name="reply" className={s.btnIcon} />
            Reply
          </button>
          <button onClick={onForward} className={s.btn}>
            <Icon name="forward" className={s.btnIcon} />
            Forward
          </button>
        </>
      )}
    </div>
  );
};
