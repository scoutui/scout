import { describe, it, expect } from "vitest";
import { assertNever } from "../../src/engine/assert-never.js";

describe("assertNever", () => {
  it("throws naming the unhandled value so a runtime miss is loud", () => {
    expect(() => assertNever({ kind: "Bogus" } as never)).toThrow(/Unhandled InferredType kind.*Bogus/);
  });
});
