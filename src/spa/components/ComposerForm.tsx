import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import {
  addressEmail,
  identityLabel,
  pickIdentity,
  splitAddressList,
} from "../../shared/compose";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import type { ComposeMode } from "../lib/composePrefs";
import { useKnownContacts } from "../lib/contacts";
import { useIdentities } from "../lib/identities";
import { sanitizeComposerHtml } from "../lib/richText";
import { Icon } from "./Icon";
import { captureSelection, FormatBar, RichTextEditor } from "./RichTextEditor";
import s from "./ComposerForm.module.css";

export interface ComposerValue {
  /** Chosen send-from identity; until the user picks, the form suggests one. */
  identityId?: string;
  to: string[];
  cc: string[];
  subject: string;
  /** The message as plain text, kept in step with `html`. */
  text: string;
  /** The editor's markup, unsanitized; see composerBody. */
  html: string;
  /** Files to attach, handed to Thunderbird's compose window as they are. */
  attachments?: File[];
}

export const emptyComposerValue = (): ComposerValue => ({
  to: [],
  cc: [],
  subject: "",
  text: "",
  html: "",
});

/** The message body as a ComposeDraft carries it. */
export const composerBody = (
  v: ComposerValue,
): { text: string; html: string; attachments?: File[] } => ({
  text: v.text,
  html: sanitizeComposerHtml(v.html),
  ...(v.attachments?.length ? { attachments: v.attachments } : {}),
});

/** Images the browser can draw, so they get a thumbnail instead of a chip. */
const isPreviewableImage = (file: File): boolean =>
  /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(file.type);

/** A local object URL for the file, revoked when the chip goes away. */
const useObjectUrl = (file: File, enabled: boolean): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, enabled]);
  return url;
};

const AttachmentChip = ({ file, onRemove }: { file: File; onRemove: () => void }) => {
  const image = isPreviewableImage(file);
  const url = useObjectUrl(file, image);
  const remove = (
    <button
      type="button"
      className={image ? s.thumbRemove : s.chipRemove}
      aria-label={`Remove ${file.name}`}
      onClick={onRemove}
    >
      <Icon name="close" className={s.chipRemoveIcon} />
    </button>
  );
  if (image) {
    return (
      <li className={s.thumb} title={`${file.name} (${formatFileSize(file.size)})`}>
        {url && <img className={s.thumbImage} src={url} alt={file.name} />}
        {remove}
      </li>
    );
  }
  return (
    <li className={s.attachment} title={file.name}>
      <Icon name="attach_file" className={s.attachmentIcon} />
      <span className={s.attachmentName}>{file.name}</span>
      <span className={s.attachmentSize}>{formatFileSize(file.size)}</span>
      {remove}
    </li>
  );
};

const formatFileSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const isComposerEmpty = (v: ComposerValue): boolean =>
  !v.text.trim() && !v.subject.trim();

const RecipientField = ({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  autoFocus?: boolean;
}) => {
  const [input, setInput] = useState("");
  const listId = useId();
  const contacts = useKnownContacts();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const commit = (raw: string): boolean => {
    const added = splitAddressList(raw).filter((a) => addressEmail(a).includes("@"));
    if (!added.length) return false;
    const have = new Set(value.map(addressEmail));
    onChange([...value, ...added.filter((a) => !have.has(addressEmail(a)))]);
    setInput("");
    return true;
  };

  return (
    <div className={s.field} onClick={() => inputRef.current?.focus()}>
      <span className={s.fieldLabel}>{label}</span>
      <div className={s.chips}>
        {value.map((raw) => (
          <span key={raw} className={s.chip} title={raw}>
            {senderName(raw) || addressEmail(raw)}
            <button
              type="button"
              className={s.chipRemove}
              aria-label={`Remove ${raw}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((v) => v !== raw));
              }}
            >
              <Icon name="close" className={s.chipRemoveIcon} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={s.chipInput}
          value={input}
          list={listId}
          aria-label={label}
          onChange={(e) => {
            const next = e.target.value;
            // Picking a suggestion fills the whole "Name <email>" at once.
            if (contacts.includes(next) && commit(next)) return;
            if (/[,;]$/.test(next)) {
              if (!commit(next.slice(0, -1))) setInput(next.slice(0, -1));
              return;
            }
            setInput(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              e.preventDefault();
              commit(input);
            } else if (e.key === "Backspace" && !input && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (input.trim()) commit(input);
          }}
        />
        <datalist id={listId}>
          {contacts.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
    </div>
  );
};

const AddressSummary = ({ label, addresses }: { label: string; addresses: string[] }) =>
  addresses.length ? (
    <>
      <span className={s.summaryLabel}>{label}</span>
      <span className={s.summaryNames}>
        {addresses.map((raw) => senderName(raw) || addressEmail(raw)).join(", ")}
      </span>
    </>
  ) : null;

/**
 * The fields and actions shared by the in-thread reply and the floating new
 * message panel. Basic formatting (bold, lists, links) goes along as HTML;
 * Thunderbird does the rest.
 *
 * In send mode a pop-out button ("finish in Thunderbird") sits at the top
 * right, unless the host shows its own (`hidePopOut`).
 *
 * With `compactAddresses` the From/To/Cc fields start folded into one line
 * that reads like a message header ("Me to Priya, Bob"); clicking it opens
 * the fields. Mail with nobody to send to yet (a forward) starts open.
 */
export const ComposerForm = ({
  value,
  onChange,
  mode,
  showSubject,
  leading,
  avatar,
  compactAddresses,
  foldAddresses,
  fill,
  hidePopOut,
  identityContext,
  placeholder = "Write your message",
  focus = "text",
  onSubmit,
  onDiscard,
  onCollapse,
}: {
  value: ComposerValue;
  onChange: (next: ComposerValue) => void;
  mode: Exclude<ComposeMode, "thunderbird">;
  showSubject?: boolean;
  /** Sits left of the address line, e.g. the reply/forward menu. */
  leading?: ReactNode;
  /** Show the sending identity's avatar, like a message in the thread. */
  avatar?: boolean;
  compactAddresses?: boolean;
  /**
   * Inbox's new-message fields: just To, with From and Cc behind a chevron
   * at its end (Cc stays out once it has someone in it).
   */
  foldAddresses?: boolean;
  /** Fill the host's height, the message growing and the toolbar at the bottom. */
  fill?: boolean;
  /** The host puts the pop-out elsewhere (e.g. in its own title bar). */
  hidePopOut?: boolean;
  /** What the default From is chosen from (see pickIdentity). */
  identityContext?: { accountId?: string; addresses?: readonly string[] };
  placeholder?: string;
  focus?: "to" | "text";
  /** `send` false means "open it in Thunderbird to finish". */
  onSubmit: (send: boolean, identityId: string | undefined) => void;
  onDiscard: () => void;
  /** Escape: put the composer away without losing what's written. */
  onCollapse?: () => void;
}) => {
  const [showCc, setShowCc] = useState(value.cc.length > 0);
  const [moreFields, setMoreFields] = useState(value.cc.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const attachments = value.attachments ?? [];
  const addFiles = (files: FileList | null) => {
    if (files?.length) onChange({ ...value, attachments: [...attachments, ...files] });
  };
  const [fieldsOpen, setFieldsOpen] = useState(!compactAddresses);
  /** Cc was opened by hand (not prefilled), so it should take the cursor. */
  const [ccRequested, setCcRequested] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const [linking, setLinking] = useState(false);
  const linkRange = useRef<Range | null>(null);
  const identities = useIdentities();
  const identityId =
    (value.identityId && identities.some((i) => i.id === value.identityId)
      ? value.identityId
      : pickIdentity(identities, identityContext)?.id) ?? value.identityId;
  const identity = identities.find((i) => i.id === identityId);
  const fromName = identity?.name || identity?.email || "Me";
  const hasRecipients = value.to.length + value.cc.length > 0;
  const showFields = fieldsOpen || !hasRecipients;

  useEffect(() => {
    if (value.cc.length) setShowCc(true);
  }, [value.cc.length]);

  useEffect(() => {
    const el = textRef.current;
    if (focus !== "text" || !el) return;
    el.focus();
    // Pick up where a restored reply or draft left off, not at its start.
    if (el.childNodes.length) window.getSelection()?.selectAllChildren(el);
    window.getSelection()?.collapseToEnd();
  }, [focus]);

  const primary = () => {
    if (mode === "send" && !hasRecipients) return;
    onSubmit(mode === "send", identityId);
  };

  const fromField = identities.length > 1 && (
    <label className={s.field}>
      <span className={s.fieldLabel}>From</span>
      <select
        className={s.fromSelect}
        value={identityId ?? ""}
        onChange={(e) => onChange({ ...value, identityId: e.target.value })}
      >
        {identities.map((identity) => (
          <option key={identity.id} value={identity.id}>
            {identityLabel(identity)}
          </option>
        ))}
      </select>
    </label>
  );
  const ccRow = foldAddresses ? moreFields || value.cc.length > 0 : showCc;

  const fields = (
    <div className={s.fields}>
      {!foldAddresses && fromField}
      <div className={s.recipients}>
        <RecipientField
          label="To"
          value={value.to}
          onChange={(to) => onChange({ ...value, to })}
          autoFocus={focus === "to" || (compactAddresses && fieldsOpen)}
        />
        {ccRow && (
          <RecipientField
            label="Cc"
            value={value.cc}
            onChange={(cc) => onChange({ ...value, cc })}
            autoFocus={ccRequested}
          />
        )}
        {foldAddresses ? (
          <button
            type="button"
            className={s.foldToggle}
            aria-expanded={moreFields}
            title={moreFields ? "Fewer fields" : "Cc and From"}
            onClick={() => setMoreFields((open) => !open)}
          >
            <Icon name={moreFields ? "expand_less" : "expand_more"} className={s.iconBtnIcon} />
          </button>
        ) : (
          !showCc && (
            <button
              type="button"
              className={s.ccToggle}
              onClick={() => {
                setShowCc(true);
                setCcRequested(true);
              }}
            >
              Cc
            </button>
          )
        )}
      </div>
      {foldAddresses && moreFields && fromField}
    </div>
  );

  const summary = (
    <button
      type="button"
      className={s.summary}
      onClick={() => setFieldsOpen(true)}
      title="Edit sender and recipients"
    >
      <span className={s.summaryFrom}>{fromName}</span>
      <AddressSummary label="to" addresses={value.to} />
      <AddressSummary label="cc" addresses={value.cc} />
      <Icon name="unfold_more" className={s.summaryExpand} />
    </button>
  );

  return (
    <div
      className={clsx(
        s.form,
        avatar && s.formWithAvatar,
        fill && s.formFill,
        dragging && s.formDragging,
      )}
      onClick={(e) => e.stopPropagation()}
      // Files dropped anywhere on the composer attach, like Inbox.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          primary();
        } else if (e.key === "Escape" && onCollapse) {
          e.preventDefault();
          e.stopPropagation();
          onCollapse();
        }
      }}
    >
      {avatar && (
        <div className={s.avatar} style={{ backgroundColor: avatarColor(fromName) }}>
          {senderInitial(fromName)}
        </div>
      )}
      <div className={s.main}>
        <div className={clsx(s.headerRow, showFields && s.headerRowOpen)}>
          {leading}
          {showFields ? fields : summary}
          {compactAddresses && showFields && hasRecipients && (
            <button
              type="button"
              className={s.collapseBtn}
              onClick={() => setFieldsOpen(false)}
              title="Collapse sender and recipients"
            >
              <Icon name="unfold_less" className={s.iconBtnIcon} />
            </button>
          )}
          {mode === "send" && !hidePopOut && (
            <button
              type="button"
              className={s.popOutBtn}
              onClick={() => onSubmit(false, identityId)}
              title="Pop out to Thunderbird (attachments, more formatting)"
              aria-label="Pop out to Thunderbird"
            >
              <Icon name="open_in_new" className={s.iconBtnIcon} />
            </button>
          )}
        </div>
        {showSubject && (
          <input
            className={s.subject}
            placeholder="Subject"
            aria-label="Subject"
            value={value.subject}
            onChange={(e) => onChange({ ...value, subject: e.target.value })}
          />
        )}
        <RichTextEditor
          editorRef={textRef}
          html={value.html}
          placeholder={placeholder}
          className={fill ? s.editorFill : undefined}
          onChange={(body) => onChange({ ...value, ...body })}
          onLinkShortcut={() => {
            linkRange.current = captureSelection(textRef.current);
            setLinking(true);
          }}
        />
        {attachments.length > 0 && (
          <ul className={s.attachments} aria-label="Attachments">
            {attachments.map((file, i) => (
              <AttachmentChip
                key={`${file.name}-${i}`}
                file={file}
                onRemove={() =>
                  onChange({ ...value, attachments: attachments.filter((_, j) => j !== i) })
                }
              />
            ))}
          </ul>
        )}
        <div className={s.actions}>
          {mode === "send" ? (
            <button
              type="button"
              className={s.sendBtn}
              disabled={!hasRecipients}
              onClick={primary}
              title="Send (Ctrl+Enter)"
            >
              Send
            </button>
          ) : (
            <button
              type="button"
              className={s.sendBtn}
              onClick={primary}
              title="Open in Thunderbird to finish (Ctrl+Enter)"
            >
              <Icon name="open_in_new" className={s.sendBtnIcon} />
              Finish in Thunderbird
            </button>
          )}
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => fileRef.current?.click()}
            title="Attach files"
          >
            <Icon name="attach_file" className={s.iconBtnIcon} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              // Picking the same file again should still fire.
              e.target.value = "";
            }}
          />
          <FormatBar
            editorRef={textRef}
            linking={linking}
            onLinkingChange={setLinking}
            savedRange={linkRange}
          />
          <span className={s.spacer} />
          <button type="button" className={s.iconBtn} onClick={onDiscard} title="Discard">
            <Icon name="delete" className={s.iconBtnIcon} />
          </button>
        </div>
      </div>
    </div>
  );
};
