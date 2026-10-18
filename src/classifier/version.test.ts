import { describe, expect, it } from "vitest";
import {
  applyClassification,
  carryClassification,
  classificationOutdated,
  CLASSIFIER_VERSION,
} from "./version";
import type { RawMessage } from "../shared/types";

const row = (over: Partial<RawMessage> = {}): RawMessage => ({
  key: "k1",
  tbId: 1,
  headerMessageId: "<a@example.com>",
  subject: "",
  author: "",
  recipients: [],
  ccList: [],
  bccList: [],
  date: 0,
  size: 0,
  read: false,
  folderId: "f1",
  accountId: "a1",
  tags: [],
  category: null,
  pinned: false,
  snoozed: false,
  origin: "inbox",
  ...over,
});

describe("classificationOutdated", () => {
  it("treats a row stamped with the current version as current", () => {
    expect(classificationOutdated(row({ classifierVersion: CLASSIFIER_VERSION }))).toBe(false);
  });

  it("treats an unstamped row as outdated", () => {
    // Every row cached before the stamp existed lands here, which is what
    // makes the first sweep after upgrading reclassify the whole cache.
    expect(classificationOutdated(row())).toBe(true);
  });

  it("treats a row stamped with an older version as outdated", () => {
    expect(classificationOutdated(row({ classifierVersion: CLASSIFIER_VERSION - 1 }))).toBe(true);
  });

  it("treats a missing row as outdated", () => {
    expect(classificationOutdated(undefined)).toBe(true);
  });

  it("does not consider a row from a future version outdated", () => {
    expect(classificationOutdated(row({ classifierVersion: CLASSIFIER_VERSION + 1 }))).toBe(false);
  });
});

describe("applyClassification", () => {
  it("stamps category, incomplete flag and the current version", () => {
    const raw = row();
    applyClassification(raw, { category: "promos", incomplete: false });
    expect(raw.category).toBe("promos");
    expect(raw.classifiedIncomplete).toBe(false);
    expect(raw.classifierVersion).toBe(CLASSIFIER_VERSION);
    expect(classificationOutdated(raw)).toBe(false);
  });

  it("records a header-only classification as incomplete so the retry sweep sees it", () => {
    const raw = row();
    applyClassification(raw, { category: null, incomplete: true });
    expect(raw.category).toBeNull();
    expect(raw.classifiedIncomplete).toBe(true);
  });
});

describe("carryClassification", () => {
  it("carries category, incomplete flag and version off the cached row", () => {
    const raw = row();
    carryClassification(
      raw,
      row({ category: "finance", classifiedIncomplete: true, classifierVersion: 1 }),
    );
    expect(raw.category).toBe("finance");
    expect(raw.classifiedIncomplete).toBe(true);
    expect(raw.classifierVersion).toBe(1);
  });

  it("keeps a carried-forward row eligible for the retry sweep", () => {
    // The bug this guards: rebuilding a row through headerToRawMessage on
    // pin/done/move used to drop classifiedIncomplete, so a row classified
    // without its body was never retried and kept a null category forever.
    const raw = row();
    carryClassification(raw, row({ category: null, classifiedIncomplete: true }));
    expect(raw.classifiedIncomplete).toBe(true);
  });

  it("leaves an unstamped cached row outdated rather than inventing a version", () => {
    const raw = row();
    carryClassification(raw, row({ category: "social" }));
    expect(raw.classifierVersion).toBeUndefined();
    expect(classificationOutdated(raw)).toBe(true);
  });

  it("falls back to unclassified when there is no cached row", () => {
    const raw = row({ category: "promos", classifiedIncomplete: true, classifierVersion: 1 });
    carryClassification(raw, undefined);
    expect(raw.category).toBeNull();
    expect(raw.classifiedIncomplete).toBe(false);
    expect(raw.classifierVersion).toBeUndefined();
  });
});
