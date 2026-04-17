import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("happy-dom provides sessionStorage", () => {
    sessionStorage.setItem("k", "v");
    expect(sessionStorage.getItem("k")).toBe("v");
  });
});
