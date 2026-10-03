import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runScan, scanExitCode } from "../../../src/commands/scan.js";
import { pushToOrigin } from "../../helpers/git-origin.js";

const { upload, check, createAuthedUploader } = vi.hoisted(() => {
  const upload = vi.fn(async () => ({ status: "inserted" as const, scanId: "S1", url: "/repos/r/scans/S1" }));
  const check = vi.fn(async (): Promise<unknown[] | null> => null);
  return { upload, check, createAuthedUploader: vi.fn(async () => ({ base: "https://h.example", check, upload })) };
});
vi.mock("../../../src/auth/upload-auth.js", () => ({ createAuthedUploader }));

const installFixture = resolve(import.meta.dirname, "../../../../../test/fixtures/unresolved-install");
const dirs: string[] = [];

// Staged outside the monorepo so no node_modules sits on the lookup path.
function stage(files: Record<string, string>, from?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-upload-policy-"));
  dirs.push(dir);
  if (from !== undefined) cpSync(from, dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  dirs.push(pushToOrigin(dir));
  return dir;
}

const config = (include: string[]) =>
  JSON.stringify({ repoId: "upload-policy", include, exclude: [] });

const aliasOnly = () =>
  stage({
    "package.json": JSON.stringify({ name: "alias-only", private: true }),
    "scout.config.json": config(["src/**/*.tsx"]),
    "src/App.tsx": `import { Button } from "@/components/Button";\nexport function App() { return <Button />; }\n`,
  });

const noComponents = () =>
  stage({
    "package.json": JSON.stringify({ name: "no-components", private: true }),
    "scout.config.json": config(["src/**/*.ts"]),
    "src/format.ts": "export const format = (n: number) => n.toFixed(2);\n",
  });

const webButtonApp = `import "@example/web-button/button.js";\nexport function App() { return <example-button />; }\n`;

const nuxtApp = (files: Record<string, string> = {}) =>
  stage({
    "package.json": JSON.stringify({ name: "nuxt-app", private: true, dependencies: { nuxt: "^4.0.0" } }),
    "node_modules/nuxt/package.json": JSON.stringify({ name: "nuxt", version: "4.0.0" }),
    "scout.config.json": config(["app.vue"]),
    "app.vue": "<template><example-card /></template>\n",
    ...files,
  });

const notInstalled = (packageName: string, declaredIn: string) =>
  `Couldn't upload the scan: ${packageName} is listed in ${declaredIn} but isn't installed. Install your dependencies and try again.`;
const NUXT_NOT_PREPARED =
  "Couldn't upload the scan: this Nuxt app hasn't been prepared. Run npx nuxt prepare and try again.";

function stderr(): string {
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join("");
}

beforeEach(() => {
  upload.mockClear();
  check.mockClear();
  createAuthedUploader.mockClear();
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("an upload's refusal", () => {
  it("refuses before scanning when a dependency imported by name is not installed", async () => {
    const dir = stage({}, installFixture);
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(upload).not.toHaveBeenCalled();
    expect(result.output).toBeNull();
    expect(result.upload).toBe("failed");
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(stderr()).toContain(notInstalled("@example/ui", "package.json"));
  });

  it("refuses before scanning when a dependency that only registers tags is not installed", async () => {
    const dir = stage({
      "package.json": JSON.stringify({ name: "tag-only", private: true, dependencies: { "@example/web-button": "1.0.0" } }),
      "scout.config.json": config(["src/**/*.tsx"]),
      "src/App.tsx": webButtonApp,
    });
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(upload).not.toHaveBeenCalled();
    expect(result.output).toBeNull();
    expect(result.upload).toBe("failed");
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(stderr()).toContain(notInstalled("@example/web-button", "package.json"));
  });

  it("refuses before scanning a Nuxt app that hasn't been prepared", async () => {
    const dir = nuxtApp();
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(upload).not.toHaveBeenCalled();
    expect(result.output).toBeNull();
    expect(result.upload).toBe("failed");
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(stderr()).toContain(NUXT_NOT_PREPARED);
  });

  it("refuses before scanning a workspace member whose own dependency is not installed", async () => {
    const dir = stage({
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["app"] }),
      "app/package.json": JSON.stringify({ name: "app", private: true, dependencies: { "@example/web-button": "1.0.0" } }),
      "app/scout.config.json": config(["src/**/*.tsx"]),
      "app/src/App.tsx": webButtonApp,
    });
    const result = await runScan({ cwd: join(dir, "app"), quiet: true, upload: true });
    expect(upload).not.toHaveBeenCalled();
    expect(result.output).toBeNull();
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "app", "scout-scan.json"))).toBe(false);
    expect(stderr()).toContain(notInstalled("@example/web-button", "app/package.json"));
  });

  it("names the missing dependencies, not the Nuxt preparation, when a Nuxt app has nothing installed", async () => {
    const dir = stage({
      "package.json": JSON.stringify({ name: "nuxt-app", private: true, dependencies: { nuxt: "^4.0.0" } }),
      "scout.config.json": config(["app.vue"]),
      "app.vue": "<template><example-card /></template>\n",
    });
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(scanExitCode(result)).toBe(1);
    expect(stderr()).toContain(notInstalled("nuxt", "package.json"));
    expect(stderr()).not.toContain(NUXT_NOT_PREPARED);
  });

  it("uploads a Nuxt app whose generated component declaration is empty", async () => {
    const result = await runScan({ cwd: nuxtApp({ ".nuxt/components.d.ts": "" }), quiet: true, upload: true });
    expect(result.output?.occurrences.length).toBeGreaterThan(0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(scanExitCode(result)).toBe(0);
  });

  it("uploads a workspace member whose dependencies are installed at the workspace root, with a peer and an optional dependency missing", async () => {
    const dir = stage({
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["app"] }),
      "node_modules/@example/web-button/package.json": JSON.stringify({ name: "@example/web-button", version: "1.0.0" }),
      "app/package.json": JSON.stringify({
        name: "app",
        private: true,
        dependencies: { "@example/web-button": "1.0.0" },
        peerDependencies: { "@example/peer": "1.0.0" },
        optionalDependencies: { "@example/optional": "1.0.0" },
      }),
      "app/scout.config.json": config(["src/**/*.tsx"]),
      "app/src/App.tsx": webButtonApp,
    });
    const result = await runScan({ cwd: join(dir, "app"), quiet: true, upload: true });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(scanExitCode(result)).toBe(0);
  });

  it("uploads a scan whose render comes from a peer dependency that isn't installed, with that render unresolved", async () => {
    const dir = stage({
      "package.json": JSON.stringify({ name: "peer-only", private: true, peerDependencies: { "@example/ui": "1.0.0" } }),
      "scout.config.json": config(["src/**/*.tsx"]),
      "src/App.tsx": `import { Button } from "@example/ui";\nexport function App() { return <Button />; }\n`,
    });
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(result.output?.occurrences.map((o) => o.resolution)).toEqual([
      { status: "unresolved", reason: { kind: "package-not-installed", packageName: "@example/ui" } },
    ]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(scanExitCode(result)).toBe(0);
  });

  it("uploads a scan whose only unresolved render is module-not-found", async () => {
    const result = await runScan({ cwd: aliasOnly(), quiet: true, upload: true });
    expect(result.output?.occurrences.map((o) => o.resolution)).toEqual([
      { status: "unresolved", reason: { kind: "module-not-found" } },
    ]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.upload).toBe("ok");
  });

  it("skips a commit the dashboard already has before checking that dependencies are installed", async () => {
    check.mockResolvedValueOnce([{ commit: "any", decision: "skip", url: "/repos/upload-policy" }]);
    const result = await runScan({ cwd: stage({}, installFixture), quiet: true, upload: true });
    expect(scanExitCode(result)).toBe(0);
    expect(stderr()).toBe("");
    expect(upload).not.toHaveBeenCalled();
  });

  it("a dry run exits 0 while a declared package is not installed", async () => {
    const result = await runScan({ cwd: stage({}, installFixture), quiet: true });
    expect(result.upload).toBe("skipped");
    expect(scanExitCode(result)).toBe(0);
    expect(result.output?.diagnostics).toContainEqual({
      code: "dependency-not-installed",
      severity: "warning",
      packageName: "@example/ui",
      occurrenceCount: 1,
      declaredIn: "package.json",
    });
  });

  it("refuses to upload a scan that found no occurrences, naming include and the config", async () => {
    const dir = noComponents();
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(result.output?.occurrences).toEqual([]);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(result.upload).toBe("failed");
    expect(scanExitCode(result)).toBe(1);
    expect(stderr()).toContain(
      `Couldn't upload the scan: no components were found. Check "include" in ${join(dir, "scout.config.json")} and try again.`,
    );
  });

  it("a dry run exits 0 when the scan found no occurrences", async () => {
    const result = await runScan({ cwd: noComponents(), quiet: true });
    expect(result.output?.occurrences).toEqual([]);
    expect(scanExitCode(result)).toBe(0);
  });
});
