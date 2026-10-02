import { describe, expect, it } from "vitest";
import { killProcessGroup, runProcess } from "../../../src/backfill/run-process.js";

const LEAVES_THE_GROUP = `
const escapee = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
console.log(escapee.pid);
escapee.unref();
setTimeout(() => {}, 10000);
`;

describe("runProcess", () => {
  it("settles at the time limit while a process that left the group still holds the output open", { timeout: 20_000 }, async () => {
    const started = Date.now();
    const result = await runProcess(process.execPath, ["-e", LEAVES_THE_GROUP], { cwd: process.cwd(), timeoutMs: 500 }).done;
    const elapsed = Date.now() - started;
    const escapee = Number.parseInt(result.output, 10);
    if (escapee > 0) killProcessGroup(escapee);
    expect(result).toMatchObject({ code: null, timedOut: true });
    expect(elapsed).toBeLessThan(3_000);
  });
});
