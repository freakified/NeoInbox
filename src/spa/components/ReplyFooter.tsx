import type { RawMessage } from "../../shared/types";
import { Icon } from "./Icon";
import s from "./ReplyFooter.module.css";

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
    <div className={s.footer}>
      <button onClick={onReply} className={s.btn}>
        <Icon name="reply" className={s.btnIcon} />
        Reply
      </button>
      <button onClick={onForward} className={s.btn}>
        <Icon name="forward" className={s.btnIcon} />
        Forward
      </button>
    </div>
  );
};
