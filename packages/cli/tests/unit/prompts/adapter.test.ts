import { describe, it, expect } from "vitest";
import { PromptCancelledError, assertNotCancelled } from "../../../src/prompts/adapter.js";

const CANCEL = Symbol("clack:cancel");
const stubPrompts = { isCancel: (v: unknown): v is symbol => v === CANCEL };

describe("assertNotCancelled", () => {
  it("returns the value when not cancelled", () => {
    expect(assertNotCancelled("https://h", stubPrompts)).toBe("https://h");
  });
  it("throws PromptCancelledError on the cancel sentinel", () => {
    expect(() => assertNotCancelled(CANCEL, stubPrompts)).toThrow(PromptCancelledError);
  });
});
