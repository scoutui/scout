import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan, scanExitCode } from "../../../src/commands/scan.js";
import * as parseModule from "../../../src/parse-by-ext.js";
import * as parserReact from "@scoutui/parser-react";
import { Logger } from "../../../src/util/log.js";

function setupConsumer() {
  const dir = mkdtempSync(join(tmpdir(), "cc-e2e-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scan-test" }));
  // Config
  writeFileSync(
    join(dir, "scout.config.json"),
    JSON.stringify({
      repoId: "scan-test",
      include: ["src/**/*.tsx"],
      exclude: [],
    })
  );
  // Source file
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "Card.tsx"), "export function Card() { return <div />; }\n");
  writeFileSync(
    join(dir, "src", "App.tsx"),
    'import { Card } from "./Card";\nexport function App() { return <Card />; }\n',
  );
  // Initial commit so git rev-parse HEAD succeeds in readCheckout.
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

describe("runScan hard errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns { output: null } on ConfigError (missing config file)", async () => {
    const result = await runScan({
      configPath: "/definitely/does/not/exist/scout.config.json",
      quiet: true,
    });
    expect(result.output).toBeNull();
  });

  it("returns { output: null } when the repository root does not exist", async () => {
    const dir = setupConsumer();
    const result = await runScan({
      configPath: join(dir, "scout.config.json"),
      repoRoot: join(dir, "missing"),
      quiet: true,
    });
    expect(result.output).toBeNull();
  });

  it("stops with one line saying how to switch Yarn off Plug'n'Play", async () => {
    const dir = setupConsumer();
    writeFileSync(join(dir, ".pnp.cjs"), "");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = await runScan({ configPath: join(dir, "scout.config.json"), quiet: true });
    expect(scanExitCode(result)).toBe(2);
    expect(stderr.mock.calls.map(([text]) => String(text)).join("")).toBe(
      "Error: Scout can't read packages installed with Yarn Plug'n'Play. Set nodeLinker: node-modules in .yarnrc.yml, run yarn install, and scan again.\n",
    );
  });
});

describe("runScan scan file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["a file outside it", (outside: string) => {
      writeFileSync(join(outside, "escape.json"), "{}\n");
      return join(outside, "escape.json");
    }],
    ["a file outside it that doesn't exist yet", (outside: string) => join(outside, "escape.json")],
  ])("doesn't write scout-scan.json on a dry run when it's a link to %s", async (_label, target) => {
    const dir = realpathSync(setupConsumer());
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "cc-outside-")));
    symlinkSync(target(outside), join(dir, "scout-scan.json"));
    const before = existsSync(join(outside, "escape.json")) ? readFileSync(join(outside, "escape.json"), "utf8") : null;
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = await runScan({ configPath: join(dir, "scout.config.json"), quiet: true });
    expect(scanExitCode(result)).toBe(2);
    expect(existsSync(join(outside, "escape.json")) ? readFileSync(join(outside, "escape.json"), "utf8") : null).toBe(before);
    expect(stderr.mock.calls.map(([text]) => String(text)).join("")).toBe(
      `Error: scout-scan.json in ${dir} links to a file outside that folder, so the scan won't write it. Delete the link and try again.\n`,
    );
  });
});

describe("runScan warnings about files it reads", () => {
  afterEach(() => vi.restoreAllMocks());

  function stderrOf(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map(([text]) => String(text)).join("");
  }

  it("skips a file it can't parse with one warning line, and the parser's own text only under debug", async () => {
    const dir = setupConsumer();
    const app = join(realpathSync(dir), "src", "App.tsx");
    const parse = parseModule.parseByExt;
    vi.spyOn(parseModule, "parseByExt").mockImplementation((file, source, report) => {
      if (file === app) throw new Error("Unexpected end of input\n  at 3:1");
      return parse(file, source, report);
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runScan({ configPath: join(dir, "scout.config.json"), quiet: true });
    expect(stderrOf(stderr)).toBe(`Warning: Skipped ${app}: couldn't parse it (Unexpected end of input at 3:1).\n`);
    stderr.mockClear();
    await runScan({ configPath: join(dir, "scout.config.json"), log: new Logger({ quiet: true, debug: true }) });
    expect(stderrOf(stderr)).toMatch(/^Warning: Skipped .*\(Unexpected end of input at 3:1\)\.\nError: Unexpected end of input\n {2}at 3:1\n/);
  });

  it("warns in one line when it can't finish reading a file", async () => {
    const dir = setupConsumer();
    const app = join(realpathSync(dir), "src", "App.tsx");
    const emit = parserReact.emitReact;
    vi.spyOn(parserReact, "emitReact").mockImplementation((input) => {
      if (input.file === "src/App.tsx") throw new Error("unexpected node");
      emit(input);
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runScan({ configPath: join(dir, "scout.config.json"), quiet: true });
    expect(stderrOf(stderr)).toBe(`Warning: Couldn't finish reading ${app} (unexpected node), so some occurrences in it may be missing.\n`);
  });

  it("prints the info counts only under debug", async () => {
    const dir = setupConsumer();
    writeFileSync(join(dir, "src", "Slot.tsx"), "export function Slot({ Inner }: { Inner: () => null }) { return <Inner />; }\n");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runScan({ configPath: join(dir, "scout.config.json"), quiet: true });
    expect(stderrOf(stderr)).toBe("");
    await runScan({ configPath: join(dir, "scout.config.json"), log: new Logger({ quiet: true, debug: true }) });
    expect(stderrOf(stderr)).toBe("1 component passed in as a prop or argument wasn't counted.\n");
  });

  it("prints a tsconfig problem under the Warning label, and its progress through the files it reads", async () => {
    const dir = setupConsumer();
    writeFileSync(join(dir, "tsconfig.json"), '{ "compilerOptions": { "paths": ');
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runScan({ configPath: join(dir, "scout.config.json") });
    const lines = stderrOf(stderr).split("\n");
    expect(lines.filter((line) => line.startsWith("Warning:"))).toEqual([
      `Warning: tsconfig parse errors in ${join(realpathSync(dir), "tsconfig.json")}: ValueExpected, CloseBraceExpected, CloseBraceExpected`,
    ]);
    expect(lines).toContainEqual(expect.stringMatching(/^Reading files: 2 of 2 \(100\.0%\), \d+\.\ds$/));
  });
});
