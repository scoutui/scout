import { describe, it, expect } from "vitest";
import { csvField } from "../../../src/reporter/csv.js";

describe("csvField", () => {
  it.each([
    ["Button", "Button"],
    ["src/a,b.tsx", '"src/a,b.tsx"'],
    ['say "hi".tsx', '"say ""hi"".tsx"'],
    ["two\nlines", '"two\nlines"'],
    ["", ""],
  ])("writes %j as %j", (value, field) => {
    expect(csvField(value)).toBe(field);
  });
});
