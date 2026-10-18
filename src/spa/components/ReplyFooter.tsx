import { liveTbId } from "../../shared/liveMessage";
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

  /** Opens a Thunderbird compose window on the message's verified live id. */
  const compose = (m: RawMessage, begin: (tbId: number) => Promise<unknown>): void => {
    void liveTbId(m).then((tbId) => (tbId === null ? undefined : begin(tbId)));
  };

  const onResumeDraft = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!draft) return;
    compose(draft, (tbId) => messenger.compose.beginNew(tbId));
  };
  const onReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!replyTarget) return;
    compose(replyTarget, (tbId) => messenger.compose.beginReply(tbId, "replyToAll"));
  };
  const onForward = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!replyTarget) return;
    compose(replyTarget, (tbId) => messenger.compose.beginForward(tbId));
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
