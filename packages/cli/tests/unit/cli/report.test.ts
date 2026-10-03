import { describe, it, expect, vi, afterEach } from "vitest";
import { reportError } from "../../../src/cli/report.js";
import { Logger } from "../../../src/util/log.js";
import { createColor } from "../../../src/util/style.js";

const plain = createColor({ isTTY: false, env: {} });
const BUGS = "https://example.com/issues";

function report(err: unknown, debug: boolean): { code: number; stderr: string } {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { chunks.push(s); return true; }) as typeof process.stderr.write);
  const code = reportError(err, new Logger({ color: plain, debug }), BUGS);
  return { code, stderr: chunks.join("") };
}

afterEach(() => vi.restoreAllMocks());

// Nothing in the shipped CLI raises an unexpected error on purpose, so the
// report for one is checked here rather than end to end.
describe("reportError", () => {
  it("asks for a report of an unexpected error, and prints its stack only under debug", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'kind')");
    expect(report(err, false)).toEqual({
      code: 1,
      stderr: `Error: Scout stopped unexpectedly (Cannot read properties of undefined (reading 'kind')). Run the command again with --debug and report the output at ${BUGS}.\n`,
    });
    expect(report(err, true)).toEqual({
      code: 1,
      stderr: `Error: Scout stopped unexpectedly (Cannot read properties of undefined (reading 'kind')). Please report this at ${BUGS}.\n${err.stack}\n`,
    });
  });
});
