import { beforeEach, describe, expect, it } from "vitest";
import { overlayIsOpen } from "./overlays";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("overlayIsOpen", () => {
  it("is false for an ordinary list", () => {
    document.body.innerHTML = '<div data-row-header tabindex="0">a row</div>';
    expect(overlayIsOpen()).toBe(false);
  });

  it.each(["dialog", "menu"])("detects an open %s", (role) => {
    document.body.innerHTML = `<div role="${role}">overlay</div>`;
    expect(overlayIsOpen()).toBe(true);
  });

  it("ignores an overlay that stays mounted but hidden while closed", () => {
    document.body.innerHTML = '<div role="menu" aria-hidden="true"></div>';
    expect(overlayIsOpen()).toBe(false);
  });

  it("goes back to false once the overlay unmounts", () => {
    document.body.innerHTML = '<div role="dialog">overlay</div>';
    document.querySelector('[role="dialog"]')!.remove();
    expect(overlayIsOpen()).toBe(false);
  });
});
