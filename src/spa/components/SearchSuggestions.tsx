import { clsx } from "clsx";
import { searchTerms } from "../../store/search";
import { avatarColor, senderInitial } from "../lib/avatar";
import type { SearchSuggestion } from "../lib/searchSuggestions";
import { ContactPhoto } from "./ContactPhoto";
import { Highlight, SearchTermsContext } from "./Highlight";
import { Icon } from "./Icon";
import s from "./SearchSuggestions.module.css";

export const SEARCH_SUGGESTIONS_ID = "neo-search-suggestions";

export const suggestionId = (index: number): string => `${SEARCH_SUGGESTIONS_ID}-${index}`;

/**
 * The search box's dropdown. Focus stays in the box: arrow keys move
 * `active` there, and a click is kept from blurring it.
 */
export const SearchSuggestions = ({
  text,
  items,
  active,
  onActiveChange,
  onPick,
}: {
  /** What's typed, whose words are marked in each suggestion. */
  text: string;
  items: readonly SearchSuggestion[];
  active: number;
  onActiveChange: (index: number) => void;
  onPick: (item: SearchSuggestion) => void;
}) => (
  <SearchTermsContext.Provider value={searchTerms(text)}>
    <ul className={s.list} role="listbox" id={SEARCH_SUGGESTIONS_ID} aria-label="Search suggestions">
      {items.map((item, i) => (
        <li
          key={item.kind === "recent" ? `recent:${item.query}` : `contact:${item.email}`}
          id={suggestionId(i)}
          role="option"
          aria-selected={i === active}
          className={clsx(s.item, i === active && s.active)}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onActiveChange(i)}
          onClick={() => onPick(item)}
        >
          {item.kind === "recent" ? (
            <>
              <span className={s.iconWrap}>
                <Icon name="history" className={s.icon} />
              </span>
              <span className={s.primary}>
                <Highlight text={item.query} />
              </span>
            </>
          ) : (
            <>
              <span className={s.avatar} style={{ backgroundColor: avatarColor(item.name || item.email) }}>
                <ContactPhoto address={item.address}>{senderInitial(item.address)}</ContactPhoto>
              </span>
              <span className={s.primary}>
                <Highlight text={item.name || item.email} />
              </span>
              {item.name && (
                <span className={s.secondary}>
                  <Highlight text={item.email} />
                </span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  </SearchTermsContext.Provider>
);
