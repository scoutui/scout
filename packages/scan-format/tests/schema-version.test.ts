import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, schemaVersionOf } from "../src/schema-version.js";

describe("schemaVersionOf", () => {
  it("reads an absent version as 1", () => {
    expect(schemaVersionOf({})).toBe(1);
  });
  it("returns a positive integer version", () => {
    expect(schemaVersionOf({ schemaVersion: 2 })).toBe(2);
    expect(schemaVersionOf({ schemaVersion: 3 })).toBe(3);
  });
  it("marks non-integer, non-positive or non-object input invalid", () => {
    expect(schemaVersionOf({ schemaVersion: "2" })).toBe("invalid");
    expect(schemaVersionOf({ schemaVersion: 0 })).toBe("invalid");
    expect(schemaVersionOf({ schemaVersion: 1.5 })).toBe("invalid");
    expect(schemaVersionOf(null)).toBe("invalid");
  });
  it("names version 2 as the current model", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});
