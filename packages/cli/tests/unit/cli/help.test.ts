import { describe, it, expect } from "vitest";
import { topHelp, commandHelp } from "../../../src/cli/help.js";

describe("topHelp", () => {
  it("lists every command and points at per-command help", () => {
    const out = topHelp();
    for (const cmd of ["scan", "init", "auth"]) expect(out).toContain(cmd);
    expect(out).toContain("  scan          Scan the repo and upload the scan to the dashboard\n");
    expect(out).toContain("  backfill      Scan one commit a week of the tracked branch's history and upload each scan\n");
    expect(out).toMatch(/--help/);
    expect(out).toMatch(/--version/);
    expect(out).toMatch(/--debug/);
  });
  it("says what each command is for in the user's words, how to start, and where the docs are", () => {
    const out = topHelp();
    expect(out).toContain("  init          Create scout.config.json for this repo\n");
    expect(out).toContain("  auth          Sign in to a dashboard, check or sign out (login | status | logout)\n");
    expect(out.endsWith("\nGet started: scout init, then scout scan --dry-run.\nDocs: https://scoutui.dev/docs\n")).toBe(true);
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
  it("describes scan's options as what they do, including --debug", () => {
    const out = commandHelp("scan");
    expect(out).toContain("  --config <path>    Config file to read (default: ./scout.config.json)\n");
    expect(out).toContain("  --quiet            Hide progress, the summary and most warnings\n");
    expect(out).toContain("  --repo-id <name>   Repository name on the dashboard (default: repoId in the config, else from the git remote)\n");
    expect(out).toContain("  --repo-root <dir>  Folder that paths in the scan file are relative to (default: the top of the git repository)\n");
    expect(out).toContain("  --host <url>       Dashboard address (default: SCOUTUI_HOST, else host in scout.config.json, else the first dashboard you signed in to)\n");
    expect(out).toContain("  --debug            Show the details behind an error\n");
  });
  it("returns the backfill options for backfill", () => {
    const out = commandHelp("backfill");
    expect(out).toContain("  --since <date>     Earliest commit date, as YYYY-MM-DD (default: six months ago)\n");
    expect(out).toContain("  --config <path>    Config file to read (default: ./scout.config.json)\n");
    expect(out).toContain("  --host <url>       Dashboard address (default: SCOUTUI_HOST, else host in scout.config.json, else the first dashboard you signed in to)\n");
  });
  it("returns auth subcommands for auth", () => {
    const out = commandHelp("auth");
    expect(out).toContain("login");
    expect(out).toContain("logout");
    expect(out).toContain("status");
    expect(out).toContain("  login   Sign in to a dashboard in your browser. Saves the session in the system keychain, or in ~/.config/scoutui/hosts.json if the keychain can't be used\n");
    expect(out).toContain("  status  Show who you're signed in as\n");
    expect(out).toContain("  logout  Sign out, ending the session on the dashboard\n");
  });
  it("lists supported framework choices for init", () => {
    const out = commandHelp("init");
    expect(out).toContain("react | vue");
    expect(out).toContain("Create scout.config.json for this repo. Asks for each setting when run in a terminal.\n");
    expect(out).toContain("  --output <path>     Where to write the config (default: ./scout.config.json)\n");
  });
  it("falls back to the top-level help for an unknown command", () => {
    expect(commandHelp("nope")).toBe(topHelp());
  });
});
