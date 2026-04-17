import { describe, it, expect, beforeEach } from "vitest";
import { saveImportState, loadImportState, clearImportState, newImportId } from "../session-state";
import type { ImportSessionState } from "../types";

function stubState(): ImportSessionState {
  return {
    importId: "abc123",
    parsedFile: { headers: ["Name"], rows: [{ Name: "x" }], rowCount: 1, fileName: "t.csv", sizeBytes: 1 },
    mappings: [],
    matchResults: [],
    batchPricingRule: "market",
    createdAt: Date.now(),
  };
}

describe("session-state", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips state", () => {
    const state = stubState();
    saveImportState(state);
    expect(loadImportState("abc123")).toEqual(state);
  });

  it("returns null for missing state", () => {
    expect(loadImportState("nope")).toBeNull();
  });

  it("clears state", () => {
    saveImportState(stubState());
    clearImportState("abc123");
    expect(loadImportState("abc123")).toBeNull();
  });

  it("expires state older than 24h", () => {
    const state = { ...stubState(), createdAt: Date.now() - 25 * 3600 * 1000 };
    saveImportState(state);
    expect(loadImportState("abc123")).toBeNull();
  });

  it("newImportId returns unique non-empty ids", () => {
    expect(newImportId()).toBeTruthy();
    expect(newImportId()).not.toBe(newImportId());
  });
});
