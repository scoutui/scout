import { describe, it, expect, vi } from "vitest";
import { Logger } from "../../../src/util/log.js";
import { createColor } from "../../../src/util/style.js";

function capture(stream: NodeJS.WriteStream, fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(stream, "write").mockImplementation(((s: string) => {
    chunks.push(s);
    return true;
  }) as typeof stream.write);
  fn();
  spy.mockRestore();
  return chunks.join("");
}

const captureStderr = (fn: () => void): string => capture(process.stderr, fn);

const plain = createColor({ isTTY: false, env: {} });

describe("Logger", () => {
  it("labels errors and warnings in plain text when colour is disabled", () => {
    const log = new Logger({ color: plain });
    expect(captureStderr(() => log.error("boom"))).toBe("Error: boom\n");
    expect(captureStderr(() => log.warn("careful"))).toBe("Warning: careful\n");
  });
  it("colours the label when colour is enabled", () => {
    const log = new Logger({ color: createColor({ isTTY: true, env: {} }) });
    const out = captureStderr(() => log.error("boom"));
    expect(out).toContain("\x1b[31m");
    expect(out).toContain("boom");
  });
  it.each([
    [true, "! Warning: careful\n", "✗ Error: boom\n", "✓ Done.\n"],
    [false, "Warning: careful\n", "Error: boom\n", "Done.\n"],
  ])("marks a warning, an error and a success with its symbol only when styled (styled: %s)", (styled, warning, error, success) => {
    const log = new Logger({ color: plain, styled, isTTY: false });
    expect(captureStderr(() => log.warn("careful"))).toBe(warning);
    expect(captureStderr(() => log.error("boom"))).toBe(error);
    expect(capture(process.stdout, () => log.success("Done."))).toBe(success);
  });
  it("prints a message with a newline, control characters and runs of spaces on one line", () => {
    const log = new Logger({ color: plain });
    expect(captureStderr(() => log.warn("Unexpected token\n  at line 3\u0007\tcolumn   4"))).toBe(
      "Warning: Unexpected token at line 3 column 4\n",
    );
  });
  it("clears a line being rewritten in place before a warning, an error or a debug line in a terminal, and not in a log", () => {
    expect(captureStderr(() => new Logger({ color: plain, isTTY: true }).warn("careful"))).toBe("\r\x1b[KWarning: careful\n");
    expect(captureStderr(() => new Logger({ color: plain, isTTY: true }).error("boom"))).toBe("\r\x1b[KError: boom\n");
    expect(captureStderr(() => new Logger({ color: plain, isTTY: true, debug: true }).detail("2 usages weren't counted."))).toBe(
      "\r\x1b[K2 usages weren't counted.\n",
    );
    expect(captureStderr(() => new Logger({ color: plain, isTTY: false, debug: true }).detail("2 usages weren't counted."))).toBe(
      "2 usages weren't counted.\n",
    );
    expect(captureStderr(() => new Logger({ color: plain, isTTY: false }).warn("careful"))).toBe("Warning: careful\n");
  });
  it("prints the detail as it is, only under debug", () => {
    const raw = "Unexpected token\n  at line 3";
    expect(captureStderr(() => new Logger({ color: plain }).error("boom", raw))).toBe("Error: boom\n");
    expect(captureStderr(() => new Logger({ color: plain, debug: true }).error("boom", raw))).toBe(`Error: boom\n${raw}\n`);
  });
});
