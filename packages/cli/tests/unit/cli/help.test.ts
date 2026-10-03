import { describe, it, expect } from "vitest";
import { topHelp, commandHelp, styleHelp } from "../../../src/cli/help.js";
import { createColor } from "../../../src/util/style.js";

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
    expect(out).toContain("  auth          Sign in to a dashboard, see who you're signed in as, or sign out (login | status | logout)\n");
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
    expect(out).toContain("  --repo-id <name>   Repository name on the dashboard (default: repoId in the config, else from the git remote, else the folder name)\n");
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
    expect(out).toContain("  --debug            Show the details behind an error\n");
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

describe("styleHelp", () => {
  it.each(["scan", "backfill", "init", "auth", "top"])("leaves the %s help as it is without colour", (command) => {
    const text = command === "top" ? topHelp() : commandHelp(command);
    expect(styleHelp(text, createColor({ isTTY: false, env: {} }))).toBe(text);
  });
  it("in colour, makes the usage line and headings bold, names the brand colour, defaults dim and the docs link the brand colour", () => {
    const color = createColor({ isTTY: true, env: {} });
    const lines = styleHelp(topHelp(), color).split("\n");
    expect(lines[0]).toBe("\x1b[1mscout <command> [options]\x1b[0m");
    expect(lines).toContain("\x1b[1mCommands:\x1b[0m");
    expect(lines).toContain("  \x1b[36mscan\x1b[0m          Scan the repo and upload the scan to the dashboard");
    expect(lines).toContain("  \x1b[36m--help, -h\x1b[0m");
    expect(lines).toContain("Docs: \x1b[36mhttps://scoutui.dev/docs\x1b[0m");
    expect(styleHelp(commandHelp("scan"), color).split("\n")).toContain(
      "  \x1b[36m--config <path>\x1b[0m    Config file to read \x1b[2m(default: ./scout.config.json)\x1b[0m",
    );
  });
});
