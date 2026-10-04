import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../dist/cli.js");

describe("integration: files the scan matches but can't read", () => {
  let dir = "";
  let artifact: ScanArtifact<Diagnostic>;
  let stdout = "";
  let stderr = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-files-not-scanned-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "files-not-scanned", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "files-not-scanned", include: ["src/**/*.{tsx,md}"] }),
      "src/App.tsx": 'import { Button } from "./Button";\nexport function App() { return <Button />; }\n',
      "src/Button.tsx": "export function Button() { return <button />; }\n",
      "src/Broken.tsx": "export function Broken() {\n  return <div>\n",
      "src/Partial.tsx": 'import { Button } from "./Button";\nconst x;\nexport function Partial() { return <Button />; }\n',
      "src/Locked.tsx": 'import { Button } from "./Button";\nexport function Locked() { return <Button />; }\n',
      "src/notes.md": "# Notes\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    await chmod(join(dir, "src/Locked.tsx"), 0o000);
    ({ stdout, stderr } = await exec("node", [cli, "scan", "--dry-run"], { cwd: dir }));
    artifact = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8")));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records a file it can't parse and a file it can't read as diagnostics, with repository-relative paths", () => {
    expect(artifact.diagnostics.filter((d) => d.code === "file-not-parsed")).toEqual([
      { code: "file-not-parsed", severity: "warning", filePath: "src/Broken.tsx", reason: "couldn't parse it (Unexpected token)" },
      { code: "file-not-parsed", severity: "warning", filePath: "src/Locked.tsx", reason: "couldn't read it" },
    ]);
  });

  it("warns once for each file it skipped", () => {
    expect(stderr).toContain("Warning: Skipped src/Broken.tsx: couldn't parse it (Unexpected token).\n");
    expect(stderr).toContain("Warning: Skipped src/Locked.tsx: couldn't read it.\n");
    expect(stderr).not.toContain("Broken.tsx has syntax errors");
  });

  it("reads a file with syntax errors the parser recovers from, and credits its uses", () => {
    const button = artifact.components.find((c) => c.identity.kind === "repository-declaration" && c.identity.exportName === "Button");
    expect(button?.stats.occurrenceCount).toBe(2);
  });

  it("names a file with syntax errors the parser recovers from by its repository-relative path", () => {
    expect(stderr).toContain(
      "Warning: src/Partial.tsx has syntax errors (Missing initializer in const declaration), so the scan read what it could.\n",
    );
  });

  it("counts only the files it read as scanned, leaving out ones it skipped and ones with an extension it doesn't read", () => {
    expect(stdout).toContain("Scanned 3 files");
  });
});
