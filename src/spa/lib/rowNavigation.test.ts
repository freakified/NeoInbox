import { beforeEach, describe, expect, it, vi } from "vitest";
import { focusedRow, keepFocusAfterRowRemoval, moveRowFocus, rowHeaders } from "./rowNavigation";

const renderRows = (count: number) => {
  document.body.innerHTML = Array.from(
    { length: count },
    // The nested button stands in for the row's hover action strip.
    (_, i) =>
      `<div data-row-header tabindex="0" id="row${i}"><button id="child${i}">row ${i}</button></div>`,
  ).join("");
};

beforeEach(() => {
  document.body.innerHTML = "";
  // jsdom has no layout, so scrollIntoView is not implemented.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("moveRowFocus", () => {
  it("enters the list at the top when nothing is focused", () => {
    renderRows(3);
    expect(moveRowFocus(1)).toBe(true);
    expect(document.activeElement?.id).toBe("row0");
  });

  it("enters at the bottom when moving backwards from nothing", () => {
    renderRows(3);
    expect(moveRowFocus(-1)).toBe(true);
    expect(document.activeElement?.id).toBe("row2");
  });

  it("steps forwards and backwards", () => {
    renderRows(3);
    moveRowFocus(1);
    moveRowFocus(1);
    expect(document.activeElement?.id).toBe("row1");
    moveRowFocus(-1);
    expect(document.activeElement?.id).toBe("row0");
  });

  it("clamps at both ends rather than wrapping", () => {
    renderRows(2);
    moveRowFocus(1);
    moveRowFocus(-1);
    expect(document.activeElement?.id).toBe("row0");
    moveRowFocus(1);
    moveRowFocus(1);
    moveRowFocus(1);
    expect(document.activeElement?.id).toBe("row1");
  });

  it("reports no movement when the list is empty", () => {
    expect(moveRowFocus(1)).toBe(false);
  });

  it("resolves the row from a control beside its header", () => {
    document.body.innerHTML = `
      <div data-row id="outer">
        <button data-row-header id="outerToggle"></button>
        <div data-row><button data-row-header id="innerToggle"></button><button id="strip"></button></div>
      </div>`;
    document.querySelector<HTMLElement>("#strip")!.focus();
    expect(focusedRow()?.id).toBe("innerToggle");
  });

  it("resolves the row from a focused descendant", () => {
    renderRows(2);
    document.querySelector<HTMLElement>("#child1")!.focus();
    expect(focusedRow()?.id).toBe("row1");
  });
});

describe("keepFocusAfterRowRemoval", () => {
  it("lands on the row that takes the removed row's place", async () => {
    renderRows(3);
    moveRowFocus(1);
    moveRowFocus(1); // row1

    keepFocusAfterRowRemoval();
    document.querySelector("#row1")!.remove();
    await new Promise(requestAnimationFrame);

    expect(document.activeElement?.id).toBe("row2");
  });

  it("falls back to the last row when the removed row was last", async () => {
    renderRows(2);
    moveRowFocus(-1); // row1

    keepFocusAfterRowRemoval();
    document.querySelector("#row1")!.remove();
    await new Promise(requestAnimationFrame);

    expect(document.activeElement?.id).toBe("row0");
  });

  it("does nothing when the list empties out", async () => {
    renderRows(1);
    moveRowFocus(1);

    keepFocusAfterRowRemoval();
    document.body.innerHTML = "";
    await new Promise(requestAnimationFrame);

    expect(rowHeaders()).toHaveLength(0);
  });
});
