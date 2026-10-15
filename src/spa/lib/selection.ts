import { create } from "zustand";

/**
 * Multi-select, by thread id. Lives outside the mail store because it is pure
 * view state: nothing about it survives a reload or reaches the background.
 *
 * Ids rather than Thread objects so a selection survives the stream being
 * re-derived (new mail, a delta landing); App resolves them against the
 * current stream and prunes the ones that have left it.
 */
interface SelectionState {
  ids: ReadonlySet<string>;
  /** The last row toggled, where a shift-click range starts from. */
  anchor: string | null;
  toggle: (id: string) => void;
  /** Selects every row from the anchor to `id`, in the order they appear on screen. */
  selectRange: (id: string) => void;
  selectAll: (ids: string[]) => void;
  /** Drops ids that are no longer in the stream. */
  retain: (present: ReadonlySet<string>) => void;
  clear: () => void;
}

/** Thread rows in document order, which is the order the user sees them in. */
export const visibleThreadIds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-thread-id]")]
    .map((el) => el.dataset.threadId)
    .filter((id): id is string => !!id);

export const useSelection = create<SelectionState>((set, get) => ({
  ids: new Set(),
  anchor: null,
  toggle: (id) => {
    const ids = new Set(get().ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    set({ ids, anchor: id });
  },
  selectRange: (id) => {
    const { anchor } = get();
    const order = visibleThreadIds();
    const from = anchor ? order.indexOf(anchor) : -1;
    const to = order.indexOf(id);
    if (from < 0 || to < 0) {
      get().toggle(id);
      return;
    }
    const ids = new Set(get().ids);
    for (const rowId of order.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(rowId);
    set({ ids, anchor: id });
  },
  selectAll: (ids) => set({ ids: new Set([...get().ids, ...ids]) }),
  retain: (present) => {
    const { ids } = get();
    if ([...ids].every((id) => present.has(id))) return;
    set({ ids: new Set([...ids].filter((id) => present.has(id))) });
  },
  clear: () => {
    if (get().ids.size === 0) return;
    set({ ids: new Set(), anchor: null });
  },
}));

export const useIsSelected = (id: string): boolean => useSelection((st) => st.ids.has(id));

export const useSelectionActive = (): boolean => useSelection((st) => st.ids.size > 0);
