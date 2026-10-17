import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clsx } from "clsx";
import { escapeHtml, htmlToPlainText, isRichTextBlank } from "../lib/richText";
import { Icon } from "./Icon";
import s from "./RichTextEditor.module.css";

/**
 * The composer's message box: a contentEditable formatted with the browser's
 * own editing commands, with Ctrl/⌘+B/I/U/K handled here. Pastes come in as plain
 * text so mail copied from elsewhere doesn't drag its styling along.
 */
export const RichTextEditor = ({
  editorRef,
  html,
  onChange,
  placeholder,
  onLinkShortcut,
  className,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  html: string;
  onChange: (next: { html: string; text: string }) => void;
  placeholder: string;
  /** Ctrl+K, ⌘K on a Mac. */
  onLinkShortcut: () => void;
  className?: string;
}) => {
  // The DOM is the source of truth while typing; only push markup in when it
  // changed from outside (a restored draft, a discard's Undo).
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [editorRef, html]);

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    onChange({ html: el.innerHTML, text: htmlToPlainText(el.innerHTML) });
  };

  return (
    <div
      ref={editorRef}
      className={clsx(s.editor, isRichTextBlank(html) && s.blank, className)}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Message"
      data-placeholder={placeholder}
      onInput={emit}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
      onKeyDown={(e) => {
        if (!(IS_MAC ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return;
        const key = e.key.toLowerCase();
        // Run these ourselves rather than trusting the engine's bindings:
        // Thunderbird's window shortcuts (⌘U is View Source) can claim them first.
        const command = SHORTCUTS[key];
        if (command) {
          e.preventDefault();
          e.stopPropagation();
          document.execCommand(command);
        } else if (key === "k") {
          e.preventDefault();
          e.stopPropagation();
          onLinkShortcut();
        }
      }}
    />
  );
};

const IS_MAC = /Mac/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

const SHORTCUTS: Record<string, string> = { b: "bold", i: "italic", u: "underline" };

const selectionIn = (editor: HTMLElement | null): Range | null => {
  const sel = window.getSelection();
  if (!editor || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
};

const linkAt = (editor: HTMLElement | null): HTMLAnchorElement | null => {
  const range = selectionIn(editor);
  const node = range?.startContainer;
  const el = node instanceof Element ? node : node?.parentElement;
  const a = el?.closest("a");
  return a && editor?.contains(a) ? a : null;
};

/** "example.com" → https://, "a@b.com" → mailto:, anything with a scheme as-is. */
const normalizeUrl = (raw: string): string => {
  const url = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
};

const COMMANDS = [
  { command: "bold", icon: "format_bold", label: `Bold (${MOD}B)` },
  { command: "italic", icon: "format_italic", label: `Italic (${MOD}I)` },
  { command: "underline", icon: "format_underlined", label: `Underline (${MOD}U)` },
  { command: "insertUnorderedList", icon: "format_list_bulleted", label: "Bulleted list" },
  { command: "insertOrderedList", icon: "format_list_numbered", label: "Numbered list" },
] as const;

type Active = Partial<Record<(typeof COMMANDS)[number]["command"] | "link", boolean>>;

/**
 * Formatting buttons for a RichTextEditor. They keep focus in the editor
 * (mousedown is swallowed), so they act on the user's selection.
 */
export const FormatBar = ({
  editorRef,
  linking,
  onLinkingChange,
  savedRange,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  linking: boolean;
  onLinkingChange: (open: boolean) => void;
  /** Where the selection was when the link field opened. */
  savedRange: RefObject<Range | null>;
}) => {
  const [active, setActive] = useState<Active>({});
  const [url, setUrl] = useState("");

  useEffect(() => {
    const refresh = () => {
      if (!selectionIn(editorRef.current)) return;
      const next: Active = { link: !!linkAt(editorRef.current) };
      for (const { command } of COMMANDS) next[command] = document.queryCommandState(command);
      setActive(next);
    };
    document.addEventListener("selectionchange", refresh);
    const el = editorRef.current;
    el?.addEventListener("input", refresh);
    return () => {
      document.removeEventListener("selectionchange", refresh);
      el?.removeEventListener("input", refresh);
    };
  }, [editorRef]);

  useEffect(() => {
    if (linking) setUrl("");
  }, [linking]);

  const restoreSelection = () => {
    const editor = editorRef.current;
    editor?.focus();
    const range = savedRange.current;
    const sel = window.getSelection();
    if (range && sel && editor?.contains(range.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const applyLink = () => {
    const href = normalizeUrl(url);
    onLinkingChange(false);
    restoreSelection();
    if (!url.trim()) return;
    if (window.getSelection()?.isCollapsed) {
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(href)}">${escapeHtml(url.trim())}</a>`,
      );
    } else {
      document.execCommand("createLink", false, href);
    }
  };

  const cancelLink = () => {
    onLinkingChange(false);
    restoreSelection();
  };

  if (linking) {
    return (
      <div className={s.linkField}>
        <Icon name="link" className={s.icon} />
        <input
          className={s.linkInput}
          autoFocus
          placeholder="Paste or type a link"
          aria-label="Link address"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyLink();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelLink();
            }
          }}
          onBlur={() => onLinkingChange(false)}
        />
        <button
          type="button"
          className={s.applyBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={applyLink}
        >
          Apply
        </button>
      </div>
    );
  }

  return (
    <div className={s.bar} role="toolbar" aria-label="Formatting">
      {COMMANDS.map(({ command, icon, label }) => (
        <button
          key={command}
          type="button"
          className={clsx(s.btn, active[command] && s.btnActive)}
          title={label}
          aria-label={label}
          aria-pressed={!!active[command]}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!selectionIn(editorRef.current)) editorRef.current?.focus();
            document.execCommand(command);
          }}
        >
          <Icon name={icon} className={s.icon} />
        </button>
      ))}
      <button
        type="button"
        className={clsx(s.btn, active.link && s.btnActive)}
        title={active.link ? "Remove link" : `Link (${MOD}K)`}
        aria-label={active.link ? "Remove link" : "Link"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const a = linkAt(editorRef.current);
          if (a) {
            // Select the whole link so unlink takes all of it, not one character.
            const range = document.createRange();
            range.selectNodeContents(a);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            document.execCommand("unlink");
            return;
          }
          savedRange.current = captureSelection(editorRef.current);
          onLinkingChange(true);
        }}
      >
        <Icon name={active.link ? "link_off" : "link"} className={s.icon} />
      </button>
      <button
        type="button"
        className={s.btn}
        title="Clear formatting"
        aria-label="Clear formatting"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => document.execCommand("removeFormat")}
      >
        <Icon name="format_clear" className={s.icon} />
      </button>
    </div>
  );
};

/** Captures the editor's selection so the link field can put it back. */
export const captureSelection = (editor: HTMLElement | null): Range | null =>
  selectionIn(editor)?.cloneRange() ?? null;
