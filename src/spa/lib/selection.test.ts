import { beforeEach, describe, expect, it } from "vitest";
import { useSelection } from "./selection";

const ids = () => [...useSelection.getState().ids].sort();

const rows = (...threadIds: string[]) => {
  document.body.innerHTML = threadIds.map((id) => `<div data-thread-id="${id}"></div>`).join("");
};

beforeEach(() => {
  document.body.innerHTML = "";
  useSelection.setState({ ids: new Set(), anchor: null });
});

describe("selection", () => {
  it("toggles a thread in and out", () => {
    useSelection.getState().toggle("a");
    expect(ids()).toEqual(["a"]);
    useSelection.getState().toggle("a");
    expect(ids()).toEqual([]);
  });

  it("selects a range in on-screen order, either direction", () => {
    rows("a", "b", "c", "d", "e");
    useSelection.getState().toggle("d");
    useSelection.getState().selectRange("b");
    expect(ids()).toEqual(["b", "c", "d"]);
  });

  it("treats a range with no anchor on screen as a plain toggle", () => {
    rows("a", "b");
    useSelection.getState().selectRange("b");
    expect(ids()).toEqual(["b"]);
  });

  it("drops threads that have left the stream", () => {
    useSelection.getState().selectAll(["a", "b", "c"]);
    useSelection.getState().retain(new Set(["a", "c", "z"]));
    expect(ids()).toEqual(["a", "c"]);
  });

  it("leaves the set untouched when nothing left, so subscribers don't re-render", () => {
    useSelection.getState().selectAll(["a"]);
    const before = useSelection.getState().ids;
    useSelection.getState().retain(new Set(["a"]));
    expect(useSelection.getState().ids).toBe(before);
  });
});
