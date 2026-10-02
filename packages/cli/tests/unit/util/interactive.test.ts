import { describe, it, expect } from "vitest";
import { isInteractive } from "../../../src/util/interactive.js";

describe("isInteractive", () => {
  it("is true only when both streams are TTYs and not suppressed", () => {
    expect(isInteractive({ stdin: { isTTY: true }, stdout: { isTTY: true }, env: {} })).toBe(true);
  });
  it("is false without a TTY on either stream", () => {
    expect(isInteractive({ stdin: { isTTY: false }, stdout: { isTTY: true }, env: {} })).toBe(false);
    expect(isInteractive({ stdin: { isTTY: true }, stdout: { isTTY: false }, env: {} })).toBe(false);
  });
  it("is false in CI", () => {
    expect(isInteractive({ stdin: { isTTY: true }, stdout: { isTTY: true }, env: { CI: "true" } })).toBe(false);
  });
  it("is false when --yes was passed", () => {
    expect(isInteractive({ stdin: { isTTY: true }, stdout: { isTTY: true }, env: {}, yes: true })).toBe(false);
  });
});
