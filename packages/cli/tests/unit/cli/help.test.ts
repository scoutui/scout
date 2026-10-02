import { describe, it, expect } from "vitest";
import { topHelp, commandHelp } from "../../../src/cli/help.js";

describe("topHelp", () => {
  it("lists every command and points at per-command help", () => {
    const out = topHelp();
    for (const cmd of ["scan", "init", "auth"]) expect(out).toContain(cmd);
    expect(out).toContain("  scan          Scan the repo and upload the scan to the dashboard\n");
    expect(out).toMatch(/--help/);
    expect(out).toMatch(/--version/);
    expect(out).toMatch(/--debug/);
  });
});

describe("commandHelp", () => {
  it("returns only the scan options for scan", () => {
    const out = commandHelp("scan");
    expect(out).toContain("Scan the repo and upload the scan to the dashboard.\n");
    expect(out).toContain("  --dry-run          Scan without uploading, and write scout-scan.json next to the config\n");
    for (const removed of ["--output", "--upload", "--commit-date"]) expect(out).not.toContain(removed);
    expect(out).not.toContain("login");
  });
  it("returns auth subcommands for auth", () => {
    const out = commandHelp("auth");
    expect(out).toContain("login");
    expect(out).toContain("logout");
    expect(out).toContain("status");
    expect(out).toContain("saves your session in the system keychain");
    expect(out).toContain("Revoke a session");
  });
  it("lists supported framework choices for init", () => {
    const out = commandHelp("init");
    expect(out).toContain("react | vue");
  });
  it("falls back to the top-level help for an unknown command", () => {
    expect(commandHelp("nope")).toBe(topHelp());
  });
});
