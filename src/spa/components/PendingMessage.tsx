import { useMemo, useRef } from "react";
import type { PendingReply } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { buildComposedSrcdoc } from "../lib/srcdoc";
import { useIframeAutoHeight } from "../lib/useIframeAutoHeight";
import { Icon } from "./Icon";
import { AddressList, displayAddressList } from "./InlineMessage";
import { ContactPhoto } from "./ContactPhoto";
import ms from "./InlineMessage.module.css";
import bs from "./MessageBody.module.css";
import s from "./PendingMessage.module.css";

/**
 * A reply on its way out, drawn like the open message it's about to become,
 * so the thread doesn't jump when Thunderbird's Sent copy takes its place.
 */
export const PendingMessage = ({ reply }: { reply: PendingReply }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcdoc = useMemo(() => buildComposedSrcdoc(reply.text, reply.html), [reply.html, reply.text]);
  const { height, onLoad } = useIframeAutoHeight(iframeRef, srcdoc);
  const name = senderName(reply.author);

  return (
    <div className={ms.message} aria-busy="true">
      <div className={`${ms.header} ${ms.headerLocked}`} onClick={(e) => e.stopPropagation()}>
        <div className={ms.avatar} style={{ backgroundColor: avatarColor(name) }}>
          <ContactPhoto address={reply.author} self>{senderInitial(reply.author)}</ContactPhoto>
        </div>
        <div className={ms.meta}>
          <div className={ms.metaLine}>
            <span className={ms.openHeaderAddresses}>
              <span className={ms.senderOpen}>{name}</span>
              <AddressList label="to" recipients={displayAddressList(reply.to)} />
              <AddressList label="cc" recipients={displayAddressList(reply.cc)} />
            </span>
            <span className={s.status}>
              {reply.status === "sending" ? (
                <>
                  <span className={s.spinner} aria-hidden="true" />
                  Sending…
                </>
              ) : (
                <>
                  <Icon name="check" className={s.check} />
                  Sent
                </>
              )}
            </span>
          </div>
          <div className={ms.bodyInner}>
            <div className={`${bs.body} ${s.body}`}>
              <iframe
                ref={iframeRef}
                className={bs.frame}
                sandbox="allow-same-origin"
                srcDoc={srcdoc}
                onLoad={onLoad}
                style={{ height }}
                title="Your reply"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
