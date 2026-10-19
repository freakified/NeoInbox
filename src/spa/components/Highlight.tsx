import { createContext, useContext, type ReactNode } from "react";
import { highlightRanges } from "../../store/search";
import s from "./Highlight.module.css";

/** The search terms rows should mark; empty outside the search view. */
export const SearchTermsContext = createContext<readonly string[]>([]);

/** `text` with whatever the current search matched in it marked. */
export const Highlight = ({ text }: { text: string }) => {
  const terms = useContext(SearchTermsContext);
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className={s.mark}>
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
};
