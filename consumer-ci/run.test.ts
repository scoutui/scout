import { describe, expect, test } from "vitest";
import { parseArgs } from "./run.js";

describe("parseArgs", () => {
  test("returns no options when none are given", () => {
    expect(parseArgs([])).toEqual({});
  });

  test("captures --target filter", () => {
    expect(parseArgs(["--target", "pie-aperture"])).toEqual({ target: "pie-aperture" });
  });

  test("captures --step and --work-dir", () => {
    expect(parseArgs(["--step", "scan", "--work-dir", "/w"])).toEqual({
      step: "scan",
      workDir: "/w",
    });
  });

  test("captures --rescan", () => {
    expect(parseArgs(["--step", "scan", "--work-dir", "/w", "--rescan"])).toEqual({
      step: "scan",
      workDir: "/w",
      rescan: true,
    });
  });
});
