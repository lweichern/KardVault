import { describe, it, expect } from "vitest";
import { parseGrading } from "../grading-parser";

describe("parseGrading", () => {
  it.each([
    ["PSA 10", { gradingCompany: "PSA", grade: "10" }],
    ["psa10", { gradingCompany: "PSA", grade: "10" }],
    ["BGS 9.5", { gradingCompany: "BGS", grade: "9.5" }],
    ["CGC 9", { gradingCompany: "CGC", grade: "9" }],
    ["ACE 10", { gradingCompany: "ACE", grade: "10" }],
    ["SGC 8.5", { gradingCompany: "SGC", grade: "8.5" }],
    ["  PSA   10  ", { gradingCompany: "PSA", grade: "10" }],
  ])("parses %s", (input, expected) => {
    expect(parseGrading(input)).toEqual(expected);
  });

  it.each(["", "   ", "raw", "Charizard PSA 10", "PSA", "10", null, undefined])(
    "returns null for %s",
    (input) => {
      expect(parseGrading(input as string)).toBeNull();
    }
  );
});
