import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "@scoutui/scan-format";
import { keepScanFormats, type Release, startUpdateCheck, updateCheckWanted, updateNotice } from "../../src/update-check.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 3, 21, 0);

let base: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "scout-update-")));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function write(path: string, text = ""): void {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), text);
}

it("states the scan format this CLI writes in its package.json, where the registry's answer carries it", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scout?: { scanFormat?: unknown } };
  expect(pkg.scout?.scanFormat).toBe(SCHEMA_VERSION);
});

describe("updateCheckWanted", () => {
  const watching = { stdin: { isTTY: true }, stdout: { isTTY: true }, stderr: { isTTY: true } };

  it.each<[string, Record<string, string>, Partial<typeof watching>, string[], boolean]>([
    ["someone is watching in a terminal", {}, {}, ["scan"], true],
    ["in CI", { CI: "true" }, {}, ["scan"], false],
    ["when output is piped", {}, { stdout: { isTTY: false } }, ["scan"], false],
    ["with SCOUTUI_NO_UPDATE_CHECK=1", { SCOUTUI_NO_UPDATE_CHECK: "1" }, {}, ["scan"], false],
    ["with SCOUTUI_NO_UPDATE_CHECK=0", { SCOUTUI_NO_UPDATE_CHECK: "0" }, {}, ["scan"], true],
    ["with NO_UPDATE_NOTIFIER set", { NO_UPDATE_NOTIFIER: "1" }, {}, ["scan"], false],
    ["under --quiet", {}, {}, ["scan", "--quiet"], false],
  ])("checks %s: %s", (_title, env, streams, argv, wanted) => {
    expect(updateCheckWanted({ argv, env, ...watching, ...streams })).toBe(wanted);
  });
});

describe("startUpdateCheck", () => {
  const cachePath = () => join(base, "cache/scoutui/update-check.json");
  const kept = () => JSON.parse(readFileSync(cachePath(), "utf8"));
  const registry = (body: unknown) => vi.fn(async () => Response.json(body));
  const keep = (contents: unknown) => write("cache/scoutui/update-check.json", JSON.stringify(contents));

  it("with nothing kept, has no answer yet, and keeps the registry's latest release and the scan format it writes for next time", async () => {
    const fetch = registry({ version: "0.3.0", scout: { scanFormat: 3 } });
    const check = startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch });
    expect(check.latest).toBeNull();
    await check.done;
    expect(fetch).toHaveBeenCalledWith("https://registry.npmjs.org/@scoutui/cli/latest", expect.anything());
    expect(kept()).toEqual({ checkedAt: NOW, latest: { version: "0.3.0", scanFormat: 3 }, scanFormats: null });
  });

  it("keeps a release that doesn't say which scan format it writes", async () => {
    await startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch: registry({ version: "0.3.0" }) }).done;
    expect(kept().latest).toEqual({ version: "0.3.0", scanFormat: null });
  });

  it.each<[string, number, number]>([
    ["less than a day ago", NOW - DAY + 60_000, 0],
    ["a day ago", NOW - DAY, 1],
  ])("gives the answer kept %s at once, and asks the registry again only if it's a day old", async (_title, checkedAt, asked) => {
    keep({ checkedAt, latest: { version: "0.2.5", scanFormat: 2 }, scanFormats: [2] });
    const fetch = registry({ version: "0.3.0", scout: { scanFormat: 3 } });
    const check = startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch });
    expect(check).toMatchObject({ latest: { version: "0.2.5", scanFormat: 2 }, scanFormats: [2] });
    await check.done;
    expect(fetch).toHaveBeenCalledTimes(asked);
    expect(kept().latest).toEqual(asked ? { version: "0.3.0", scanFormat: 3 } : { version: "0.2.5", scanFormat: 2 });
  });

  it("offline, keeps the last answer and doesn't ask again that day", async () => {
    keep({ checkedAt: NOW - DAY, latest: { version: "0.2.5", scanFormat: 2 }, scanFormats: null });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch: offline }).done;
    const fetch = registry({ version: "0.3.0" });
    const check = startUpdateCheck({ cachePath: cachePath(), now: NOW + 60_000, fetch });
    await check.done;
    expect(fetch).not.toHaveBeenCalled();
    expect(check.latest).toEqual({ version: "0.2.5", scanFormat: 2 });
  });

  it("gives up when the registry takes longer than the time allowed", async () => {
    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    await startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch: slow, timeoutMs: 20 }).done;
    expect(kept()).toEqual({ checkedAt: NOW, latest: null, scanFormats: null });
  });

  it.each<[string, unknown]>([
    ["a page from a proxy", "<!doctype html><title>Sign in</title>"],
    ["no version", { name: "@scoutui/cli" }],
  ])("keeps no release when the registry answers with %s", async (_title, body) => {
    const fetch = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body)));
    await startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch }).done;
    expect(kept().latest).toBeNull();
  });

  it("gives the scan formats the dashboard last said it reads, kept beside the latest release", async () => {
    keep({ checkedAt: NOW, latest: { version: "0.3.0", scanFormat: 3 }, scanFormats: null });
    keepScanFormats(cachePath(), [2]);
    expect(startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch: registry({}) })).toMatchObject({
      latest: { version: "0.3.0", scanFormat: 3 },
      scanFormats: [2],
    });
  });

  it("keeps the dashboard's scan formats when it asks the registry again", async () => {
    keep({ checkedAt: NOW - DAY, latest: null, scanFormats: [2] });
    await startUpdateCheck({ cachePath: cachePath(), now: NOW, fetch: registry({ version: "0.3.0" }) }).done;
    expect(kept().scanFormats).toEqual([2]);
  });
});

describe("updateNotice", () => {
  const UPDATE = "Scout 0.3.0 is available. Update with npm i -D @scoutui/cli@latest.";
  const BEHIND =
    "Scout 0.3.0 is available, but your dashboard can't read its scans yet.\nKeep this version until your dashboard is upgraded.\nSee https://scoutui.dev/docs/guides/upgrade-scout#version-messages";

  beforeEach(() => {
    write("repo/package-lock.json");
    write("repo/package.json", JSON.stringify({ devDependencies: { "@scoutui/cli": "0.2.0" } }));
  });

  it.each<[string, string, Release | null, number[] | null, string | null]>([
    ["a newer release the dashboard reads", "0.2.0", { version: "0.3.0", scanFormat: SCHEMA_VERSION }, [SCHEMA_VERSION], UPDATE],
    ["a newer release the dashboard can't read", "0.2.0", { version: "0.3.0", scanFormat: SCHEMA_VERSION + 1 }, [SCHEMA_VERSION], BEHIND],
    ["the same version", "0.3.0", { version: "0.3.0", scanFormat: SCHEMA_VERSION }, [SCHEMA_VERSION], null],
    ["no dashboard asked", "0.2.0", { version: "0.3.0", scanFormat: SCHEMA_VERSION + 1 }, null, UPDATE],
    ["a release that doesn't say its scan format", "0.2.0", { version: "0.3.0", scanFormat: null }, [SCHEMA_VERSION], UPDATE],
    ["no answer from the registry", "0.2.0", null, [SCHEMA_VERSION], null],
    ["a snapshot build", "0.0.0-pr-57-a1c9e04-20261003210000", { version: "0.3.0", scanFormat: SCHEMA_VERSION }, null, null],
  ])("for %s", async (_title, running, latest, scanFormats, line) => {
    expect(updateNotice({ running, latest, scanFormats, cwd: join(base, "repo"), root: base })).toBe(line);
  });

  it.each<[string, Record<string, string>, string]>([
    ["npm", { "package-lock.json": "" }, "Update with npm i -D @scoutui/cli@latest."],
    ["Yarn", { "yarn.lock": "__metadata:\n  version: 8\n" }, "Update with yarn add -D @scoutui/cli@latest."],
    ["Yarn 1", { "yarn.lock": "# yarn lockfile v1\n" }, "Update with yarn add -D @scoutui/cli@latest."],
    ["pnpm", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "Update with pnpm add -D @scoutui/cli@latest."],
    ["Bun", { "bun.lock": "" }, "Update with bun add -d @scoutui/cli@latest."],
    ["no lockfile", {}, "Update with npm i -D @scoutui/cli@latest."],
  ])("with %s, names the install command when the repo's root installs the CLI", async (_title, lockfiles, end) => {
    for (const [name, text] of Object.entries(lockfiles)) write(`app/${name}`, text);
    write("app/package.json", JSON.stringify({ devDependencies: { "@scoutui/cli": "0.2.0" } }));
    write("app/web/package.json", JSON.stringify({ name: "web" }));
    const line = updateNotice({ running: "0.2.0", latest: { version: "0.3.0", scanFormat: null }, scanFormats: null, cwd: join(base, "app/web"), root: base });
    expect(line).toBe(`Scout 0.3.0 is available. ${end}`);
  });

  it.each<[string, Record<string, string>, Record<string, unknown>, string]>([
    ["pnpm adds -w", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "pnpm-workspace.yaml": "packages:\n  - web\n" }, {}, "pnpm add -D -w"],
    ["Yarn 1 adds -W", { "yarn.lock": "# yarn lockfile v1\n" }, { workspaces: ["web"] }, "yarn add -D -W"],
    ["Yarn 2 or later adds nothing, needing no flag", { "yarn.lock": "__metadata:\n  version: 8\n" }, { workspaces: ["web"] }, "yarn add -D"],
  ])("at a workspace root that installs the CLI, %s", async (_title, files, manifest, install) => {
    for (const [name, text] of Object.entries(files)) write(`app/${name}`, text);
    write("app/package.json", JSON.stringify({ ...manifest, devDependencies: { "@scoutui/cli": "0.2.0" } }));
    const line = updateNotice({ running: "0.2.0", latest: { version: "0.3.0", scanFormat: null }, scanFormats: null, cwd: join(base, "app"), root: base });
    expect(line).toBe(`Scout 0.3.0 is available. Update with ${install} @scoutui/cli@latest.`);
  });

  it.each<[string, Record<string, string>, string]>([
    ["npm", { "package-lock.json": "" }, "npm i -D"],
    ["Yarn", { "yarn.lock": "__metadata:\n  version: 8\n" }, "yarn add -D"],
    ["Yarn 1", { "yarn.lock": "# THIS IS AN AUTOGENERATED FILE.\n# yarn lockfile v1\n" }, "yarn add -D"],
    ["pnpm", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "pnpm add -D"],
    ["Bun", { "bun.lock": "" }, "bun add -d"],
    ["a pnpm workspace, at its root", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "pnpm-workspace.yaml": "packages:\n  - web\n" }, "pnpm add -D -w"],
  ])("with %s, says to install the CLI as a dev dependency when the repo doesn't", (_title, files, install) => {
    for (const [name, text] of Object.entries(files)) write(`app/${name}`, text);
    write("app/package.json", JSON.stringify({ dependencies: { react: "19.0.0" } }));
    const line = updateNotice({ running: "0.2.0", latest: { version: "0.3.0", scanFormat: null }, scanFormats: null, cwd: join(base, "app"), root: base });
    expect(line).toBe(`Scout 0.3.0 is available. Install it with ${install} @scoutui/cli@latest.`);
  });

  it("in a folder of a pnpm workspace without its own package.json, says to install the CLI at the root, with -w", () => {
    write("app/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write("app/pnpm-workspace.yaml", "packages:\n  - web\n");
    write("app/package.json", JSON.stringify({ name: "app" }));
    write("app/scripts/scan.sh");
    const line = updateNotice({ running: "0.2.0", latest: { version: "0.3.0", scanFormat: null }, scanFormats: null, cwd: join(base, "app/scripts"), root: base });
    expect(line).toBe("Scout 0.3.0 is available. Install it with pnpm add -D -w @scoutui/cli@latest.");
  });

  it("in a pnpm workspace's package that doesn't install the CLI, says to install it in that package, without -w", () => {
    write("app/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write("app/pnpm-workspace.yaml", "packages:\n  - web\n");
    write("app/package.json", JSON.stringify({ name: "app" }));
    write("app/web/package.json", JSON.stringify({ name: "web" }));
    const line = updateNotice({ running: "0.2.0", latest: { version: "0.3.0", scanFormat: null }, scanFormats: null, cwd: join(base, "app/web"), root: base });
    expect(line).toBe("Scout 0.3.0 is available. Install it with pnpm add -D @scoutui/cli@latest.");
  });
});
