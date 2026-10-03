import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan, scanExitCode } from "../../../src/commands/scan.js";
import { saveStore } from "../../../src/auth/store.js";
import { Logger } from "../../../src/util/log.js";
import { pushToOrigin } from "../../helpers/git-origin.js";
import { preScanReply } from "../../helpers/fake-dashboard.js";
import { assertValidArtifact } from "../../helpers/artifact.js";

const { bugs } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { bugs: string };
const UPLOAD_LIMIT_PAGE = "https://scoutui.dev/docs/guides/deploy-with-your-own-chart#change-an-upload-limit";
const dirs: string[] = [];
const receipt = { uploadId: "U1", statusUrl: "/api/scans/uploads/U1" };
const ready = { state: "ready", readable: true, scanId: "S1", url: "https://h.example/repos/repo-a/scans/S1" };
const LOST_CONTACT = "Error: Lost contact with the dashboard while it processed the scan. Check the dashboard in a few minutes, and scan again if the scan isn't there.\n";
const STILL_PROCESSING = "Error: The dashboard is still processing the scan after 5 minutes. It will appear on the dashboard when it's done.\n";

function setupConsumer(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-upload-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "upload-test" }));
  writeFileSync(join(dir, "scout.config.json"),
    JSON.stringify({ repoId: "upload-test", include: ["src/**/*.tsx"], exclude: [], host: "https://h.example" }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "App.tsx"), "export function Box() { return <div />; }\nexport function App() { return <Box />; }");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  dirs.push(pushToOrigin(dir));
  return dir;
}

beforeEach(() => {
  vi.stubEnv("SCOUTUI_TOKEN", "ci-secret");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function stdout(): string {
  return vi.mocked(process.stdout.write).mock.calls.map(([text]) => String(text)).join("");
}
function stderr(): string {
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join("");
}

describe("runScan upload outcome", () => {
  it.each(["transport", "500", "unauthorized"])("prints one line when waiting for the dashboard stops after a %s failure", async (mode) => {
    const dir = setupConsumer();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }));
    if (mode === "unauthorized") {
      vi.stubEnv("SCOUTUI_TOKEN", "");
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      await saveStore({ hosts: { "https://h.example": {
        token: "scout_u_user", userEmail: "user@example.com",
      } } });
      fetchSpy.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    } else if (mode === "500") {
      fetchSpy.mockResolvedValueOnce(Response.json({}, { status: 500 }));
    } else {
      fetchSpy.mockRejectedValueOnce(new Error("connection reset"));
    }
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(result.upload).toBe("failed");
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(stderr()).toBe(mode === "unauthorized"
      ? "Error: Session for https://h.example is no longer valid. Run `scout auth login --host https://h.example`.\n"
      : LOST_CONTACT);
    expect(stdout()).not.toMatch(/Uploaded|already on the dashboard/);
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "GET"]);
  });

  it("on a dry run from a folder that links to the repo, writes scout-scan.json next to the config and names it from that folder under --quiet, without contacting the dashboard", async () => {
    const dir = setupConsumer();
    const linkParent = mkdtempSync(join(tmpdir(), "cc-upload-link-"));
    dirs.push(linkParent);
    const link = join(linkParent, "repo");
    symlinkSync(dir, link);
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await runScan({ cwd: link, quiet: true });
    expect(JSON.parse(readFileSync(join(dir, "scout-scan.json"), "utf8"))).toEqual(result.output);
    expect(stdout()).toBe("Wrote scout-scan.json (not uploaded).\n");
    expect(result.upload).toBe("skipped");
    expect(scanExitCode(result)).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["a dry run", false],
    ["an upload", true],
  ])("stops %s with exit 2 before scanning when no file matches include, without contacting the dashboard", async (_label, upload) => {
    const dir = setupConsumer();
    writeFileSync(join(dir, "scout.config.json"),
      JSON.stringify({ repoId: "upload-test", include: ["lib/**/*.tsx", "app/**/*.vue"], exclude: [], host: "https://h.example" }));
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await runScan({ configPath: join(dir, "scout.config.json"), upload });
    expect(scanExitCode(result)).toBe(2);
    expect(stderr()).toBe(
      `Error: No files match "include" in ${join(dir, "scout.config.json")} (lib/**/*.tsx, app/**/*.vue). Point it at your source files and scan again.\n`,
    );
    expect(stdout()).toBe("");
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says once that it's waiting for the dashboard, then reports the published URL", async () => {
    const dir = setupConsumer();
    let firstGet: () => void = () => {};
    const gotStatus = new Promise<void>((resolve) => { firstGet = resolve; });
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockImplementationOnce(async () => { vi.useFakeTimers(); return Response.json(receipt, { status: 202 }); })
      .mockImplementationOnce(async () => { firstGet(); return Response.json({ state: "queued", readable: false }); })
      .mockResolvedValueOnce(Response.json({ state: "processing", readable: false, stage: "publishing" }))
      .mockResolvedValueOnce(Response.json(ready));
    const result = runScan({ cwd: dir, upload: true });
    await gotStatus;
    await vi.advanceTimersByTimeAsync(0);
    const waiting = "Waiting for the dashboard to process the scan…\n";
    expect(stdout().endsWith(waiting)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stdout().split(waiting)).toHaveLength(2);
    expect(stdout()).not.toMatch(/Uploaded|already on the dashboard/);
    await vi.advanceTimersByTimeAsync(2_000);
    const completed = await result;
    expect(completed.upload).toBe("ok");
    expect(scanExitCode(completed)).toBe(0);
    expect(stdout()).toContain(`Uploaded the scan of ${completed.output?.meta.repo.commit.slice(0, 7)}: https://h.example/repos/repo-a/scans/S1\n`);
    expect(stdout()).not.toContain("https://h.examplehttps://");
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "GET", "GET", "GET"]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://h.example/api/scans/preflight");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://h.example/api/scans");
  });

  it.each([
    ["after a dry run in a terminal", false, true, true],
    ["after a dry run in a log", false, false, false],
    ["after an upload in a terminal", true, true, false],
  ])("lists the most used components only on a dry run in a terminal (%s)", async (_case, upload, interactive, listed) => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    await runScan({ cwd: dir, upload, log: new Logger({ interactive, styled: false }) });
    expect(stdout().includes("Most used:\n  Box")).toBe(listed);
  });

  it("says the commit is already on the dashboard and how to scan it again", async () => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ ...ready, state: "duplicate" }));
    const result = await runScan({ cwd: dir, upload: true });
    const commit = result.output?.meta.repo.commit.slice(0, 7);
    expect(stdout()).toContain(`Commit ${commit} is already on the dashboard: https://h.example/repos/repo-a/scans/S1. Run scout scan --rescan to scan it again.\n`);
    expect(scanExitCode(result)).toBe(0);
  });

  it("asks the dashboard to replace the commit's scan on a rescan, and says it replaced one", async () => {
    const dir = setupConsumer();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ ...ready, replaced: true }));
    const result = await runScan({ cwd: dir, upload: true, rescan: true });
    const commit = result.output?.meta.repo.commit.slice(0, 7);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://h.example/api/scans/preflight");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://h.example/api/scans?rescan=1");
    expect(stdout()).toContain(`Uploaded the scan of ${commit}, replacing the earlier one: https://h.example/repos/repo-a/scans/S1\n`);
    expect(result.upload).toBe("ok");
  });

  it("prints the dashboard's refusal of a rescan from an older CLI and fails the command", async () => {
    const dir = setupConsumer();
    const message = "Couldn't upload the scan: a1c9e04 was scanned with a newer CLI (1.4.0). Upgrade the CLI to 1.4.0 or newer, or run npx @scoutui/cli@1.4.0 scan --rescan.";
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ state: "failed", readable: false, error: { code: "scanned_with_newer_cli", message } }));
    const result = await runScan({ cwd: dir, quiet: true, upload: true, rescan: true });
    expect(stderr()).toBe(`Error: ${message}\n`);
    expect(scanExitCode(result)).toBe(1);
  });

  it("returns exists only after the duplicate is readable", async () => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ ...ready, state: "duplicate" }));
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(result.upload).toBe("exists");
    expect(scanExitCode(result)).toBe(0);
    expect(stdout()).toBe(`Commit ${assertValidArtifact(result.output).meta.repo.commit.slice(0, 7)} is already on the dashboard: https://h.example/repos/repo-a/scans/S1. Run scout scan --rescan to scan it again.\n`);
  });

  it("prints the dashboard's processing error with where to report it, and its code only under debug", async () => {
    const dir = setupConsumer();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ state: "failed", readable: false, error: { code: "invalid_artifact", message: "Invalid artifact" } }));
    const result = await runScan({ cwd: dir, upload: true, log: new Logger({ quiet: true, debug: true }) });
    expect(result.output).not.toBeNull();
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(result.upload).toBe("failed");
    expect(scanExitCode(result)).toBe(1);
    expect(stderr()).toBe(`Error: Invalid artifact See ${bugs}\ninvalid_artifact (https://h.example/api/scans/uploads/U1)\n`);
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "GET"]);
  });

  it.each([
    ["decoded_limit", "Couldn't upload the scan: it's larger than this dashboard accepts. Ask your dashboard administrator to raise SCOUTUI_MAX_DECODED_ARTIFACT_BYTES.", UPLOAD_LIMIT_PAGE],
    ["unsupported_version", "Couldn't upload the scan: this CLI is too old for the dashboard. Upgrade the CLI and try again.", "https://scoutui.dev/docs/guides/upgrade-scout#version-messages"],
    ["repo_remote_mismatch", "Couldn't upload the scan: upload-test on the dashboard comes from github.com/acme/web. Scan a clone of that repository, or choose another repoId in scout.config.json.", "https://scoutui.dev/docs/guides/troubleshoot-a-scan#repository-from-another-remote"],
  ])("links the dashboard's %s refusal to the page that explains it", async (code, message, page) => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ state: "failed", readable: false, error: { code, message } }));
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(stderr()).toBe(`Error: ${message} See ${page}\n`);
    expect(scanExitCode(result)).toBe(1);
  });

  it("says the dashboard is still processing, and exits nonzero", async () => {
    const dir = setupConsumer();
    let firstGet: () => void = () => {};
    const gotStatus = new Promise<void>((resolve) => { firstGet = resolve; });
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockImplementationOnce(async () => { vi.useFakeTimers(); return Response.json(receipt, { status: 202 }); })
      .mockImplementation(async () => { firstGet(); return Response.json({ state: "queued", readable: false, retryAfterSeconds: 600 }); });
    const result = runScan({ cwd: dir, quiet: true, upload: true });
    await gotStatus;
    await vi.advanceTimersByTimeAsync(300_000);
    const pending = await result;
    expect(pending.output).not.toBeNull();
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(scanExitCode(pending)).toBe(1);
    expect(stderr()).toBe(STILL_PROCESSING);
    expect(stdout()).not.toMatch(/Uploaded|already on the dashboard/);
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "GET"]);
  });

  it("prints the last failed status check under debug when the wait expires while retrying", async () => {
    const dir = setupConsumer();
    let firstGet: () => void = () => {};
    const gotStatus = new Promise<void>((resolve) => { firstGet = resolve; });
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockImplementationOnce(async () => { vi.useFakeTimers(); return Response.json(receipt, { status: 202 }); })
      .mockImplementation(async () => { firstGet(); return Response.json({}, { status: 503, headers: { "Retry-After": "600" } }); });
    const result = runScan({ cwd: dir, upload: true, log: new Logger({ quiet: true, debug: true }) });
    await gotStatus;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(scanExitCode(await result)).toBe(1);
    expect(stderr()).toBe(
      `${STILL_PROCESSING}Upload U1 is still pending. Check https://h.example/api/scans/uploads/U1; the server job continues. The last status check failed: Upload status failed (503).\n`,
    );
  });

  it("prints the uploaded line under --quiet", async () => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(stdout()).toBe(`Uploaded the scan of ${result.output?.meta.repo.commit.slice(0, 7)}: https://h.example/repos/repo-a/scans/S1\n`);
  });
});

describe("runScan upload refused before the dashboard stores it", () => {
  const busy = "Error: Couldn't upload the scan: the dashboard is busy. Try again in a few minutes.\n";
  it.each([
    ["too large", 413, `Error: Couldn't upload the scan: it's larger than the dashboard accepts. Ask your dashboard administrator to raise the upload limit. See ${UPLOAD_LIMIT_PAGE}\n`],
    ["rate limited", 429, busy],
    ["unavailable after retries", 503, busy],
    ["another error", 500, "Error: Couldn't upload the scan: the dashboard returned an error. Try again, or ask your dashboard administrator to check its logs.\n"],
  ])("prints one line when the upload is %s (HTTP %i)", async (_case, status, line) => {
    const dir = setupConsumer();
    const reply = () => Response.json({ error: "from the dashboard" }, { status });
    let posted: () => void = () => {};
    const firstPost = new Promise<void>((resolve) => { posted = resolve; });
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockImplementationOnce(async () => { vi.useFakeTimers(); posted(); return reply(); })
      .mockImplementation(async () => reply());
    const result = runScan({ cwd: dir, quiet: true, upload: true });
    await firstPost;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scanExitCode(await result)).toBe(1);
    expect(stderr()).toBe(line);
  });

  it.each([
    ["a web page", () => new Response("<!doctype html><title>Example Domain</title>", { status: 405, headers: { "Content-Type": "text/html" } }),
      "Error: Couldn't upload the scan: https://h.example didn't answer like a Scout dashboard. Check the dashboard address and try again.\n"],
    ["a dashboard's own error", () => Response.json({ error: "from the dashboard" }, { status: 400 }),
      "Error: Couldn't upload the scan: the dashboard returned an error. Try again, or ask your dashboard administrator to check its logs.\n"],
  ])("stops before scanning when the address answers the pre-scan check with %s, and says which it was", async (_case, reply, line) => {
    const dir = setupConsumer();
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => reply());
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(result.output).toBeNull();
    expect(scanExitCode(result)).toBe(1);
    expect(stderr()).toBe(line);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("shows the dashboard's reply only under debug", async () => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch").mockImplementationOnce(preScanReply()).mockResolvedValue(Response.json({ error: "Scan too large (limit 42 MiB)" }, { status: 413 }));
    await runScan({ cwd: dir, upload: true, log: new Logger({ quiet: true, debug: true }) });
    expect(stderr()).toBe(
      `Error: Couldn't upload the scan: it's larger than the dashboard accepts. Ask your dashboard administrator to raise the upload limit. See ${UPLOAD_LIMIT_PAGE}\nThe dashboard replied: HTTP 413 {"error":"Scan too large (limit 42 MiB)"}\n`,
    );
  });

  it("says it couldn't reach the dashboard when the upload's connection fails", async () => {
    const dir = setupConsumer();
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND h.example"), { code: "ENOTFOUND" });
    vi.spyOn(global, "fetch").mockImplementationOnce(preScanReply()).mockRejectedValue(new TypeError("fetch failed", { cause }));
    expect(scanExitCode(await runScan({ cwd: dir, quiet: true, upload: true }))).toBe(1);
    expect(stderr()).toBe("Error: Couldn't reach https://h.example. Check your connection and try again.\n");
  });
});

describe("runScan pre-scan check", () => {
  const DASHBOARD_ERROR = "Couldn't upload the scan: the dashboard returned an error. Try again, or ask your dashboard administrator to check its logs.";
  const BUSY = "Couldn't upload the scan: the dashboard is busy. Try again in a few minutes.";
  const head = (dir: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  const debug = () => new Logger({ quiet: true, debug: true });

  it("asks about the commit, remote and repository name the scan records", async () => {
    const dir = setupConsumer();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(preScanReply())
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const { meta } = assertValidArtifact((await runScan({ cwd: dir, quiet: true, upload: true })).output);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://h.example/api/scans/preflight");
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      repoId: meta.repo.id, remote: meta.repo.gitRemote, scanner: meta.scannerName, scannerVersion: meta.scannerVersion,
      schemaVersion: meta.schemaVersion, rescan: false, commits: [meta.repo.commit],
    });
  });

  it("stops before scanning when the dashboard already has the commit, and says so under --quiet", async () => {
    const dir = setupConsumer();
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementationOnce(preScanReply({ decision: "skip", url: "/repos/upload-test" }));
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(stdout()).toBe(`Commit ${head(dir).slice(0, 7)} is already on the dashboard: https://h.example/repos/upload-test. Run scout scan --rescan to scan it again.\n`);
    expect(result).toEqual({ output: null, upload: "exists" });
    expect(scanExitCode(result)).toBe(0);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops before scanning when the dashboard refuses the commit", async () => {
    const dir = setupConsumer();
    const message = "Couldn't upload the scan: a1c9e04 was scanned with a newer CLI (1.4.0). Upgrade the CLI to 1.4.0 or newer, or run npx @scoutui/cli@1.4.0 scan --rescan.";
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementationOnce(preScanReply({ decision: "refuse", code: "scanned_with_newer_cli", message }));
    const result = await runScan({ cwd: dir, quiet: true, upload: true, rescan: true });
    expect(stderr()).toBe(`Error: ${message}\n`);
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({ rescan: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("prints the dashboard's warning line, then its refusal of the whole scan, under --quiet", async () => {
    const dir = setupConsumer();
    const message = "Couldn't upload the scan: upload-test on the dashboard comes from github.com/acme/web. Scan a clone of that repository, or choose another repoId in scout.config.json.";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      Response.json({ refusal: { code: "repo_remote_mismatch", message }, commits: [], warning: "A line from the dashboard." }),
    );
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(stderr()).toBe(
      `Warning: A line from the dashboard.\nError: ${message} See https://scoutui.dev/docs/guides/troubleshoot-a-scan#repository-from-another-remote\n`,
    );
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
  });

  it("skips the check on a dashboard that doesn't offer it, saying so under debug, and uploads", async () => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const result = await runScan({ cwd: dir, upload: true, log: debug() });
    expect(result.upload).toBe("ok");
    expect(stderr()).toBe("Skipped the pre-scan check: https://h.example doesn't offer it. The upload will check the scan instead.\n");
  });

  it.each<[string, unknown, number[] | undefined]>([
    ["lists them", [2, 3], [2, 3]],
    ["doesn't say", undefined, undefined],
    ["lists something other than formats", ["2"], undefined],
  ])("passes on the scan formats the dashboard reads when its reply %s, and uploads", async (_, scanFormats, heard) => {
    const dir = setupConsumer();
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(async (input, init) => {
        const reply = (await (await preScanReply()(input, init)).json()) as Record<string, unknown>;
        return Response.json({ ...reply, scanFormats });
      })
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const onScanFormats = vi.fn();
    const result = await runScan({ cwd: dir, quiet: true, upload: true, onScanFormats });
    expect(result.upload).toBe("ok");
    expect(onScanFormats.mock.calls).toEqual(heard === undefined ? [] : [[heard]]);
  });

  it.each<[string, (commit: string) => string]>([
    ["an answer it doesn't know", (commit) => JSON.stringify({ refusal: null, commits: [{ commit, decision: "later" }], warning: null })],
    ["a page from a sign-in proxy", () => "<!doctype html><title>Sign in</title>"],
  ])("skips the check when the reply is %s, showing the reply under debug, and uploads", async (_, reply) => {
    const dir = setupConsumer();
    const body = reply(head(dir));
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const result = await runScan({ cwd: dir, upload: true, log: debug() });
    expect(result.upload).toBe("ok");
    expect(stderr()).toBe(`Skipped the pre-scan check: https://h.example's reply couldn't be read. The upload will check the scan instead.\n${body}\n`);
  });

  it.each<[number, Record<string, string>, string, number]>([
    [400, { error: "invalid request body" }, `Error: ${DASHBOARD_ERROR}\nThe dashboard replied: HTTP 400 {"error":"invalid request body"}\n`, 1],
    [401, { error: "unauthorized" }, "Error: Couldn't upload the scan: the dashboard rejected SCOUTUI_TOKEN. Check that it matches the dashboard's upload token.\n", 1],
    [429, { error: "rate_limited" }, `Error: ${BUSY}\nThe dashboard replied: HTTP 429 {"error":"rate_limited"}\n`, 1],
    [500, { error: "server_error" }, `Error: ${DASHBOARD_ERROR}\nThe dashboard replied: HTTP 500 {"error":"server_error"}\n`, 1],
    [503, { error: "unavailable" }, `Error: ${BUSY}\nThe dashboard replied: HTTP 503 {"error":"unavailable"}\n`, 3],
  ])("stops before scanning when the check answers HTTP %i", async (status, body, expected, calls) => {
    const dir = setupConsumer();
    let asked: () => void = () => {};
    const firstAsk = new Promise<void>((resolve) => { asked = resolve; });
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(async () => { vi.useFakeTimers(); asked(); return Response.json(body, { status }); })
      .mockImplementation(async () => Response.json(body, { status }));
    const result = runScan({ cwd: dir, upload: true, log: debug() });
    await firstAsk;
    await vi.advanceTimersByTimeAsync(10_000);
    const stopped = await result;
    expect(stderr()).toBe(expected);
    expect(scanExitCode(stopped)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(calls);
  });

  it("asks again when the check answers HTTP 503, then scans and uploads", async () => {
    const dir = setupConsumer();
    let asked: () => void = () => {};
    const firstAsk = new Promise<void>((resolve) => { asked = resolve; });
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(async () => { vi.useFakeTimers(); asked(); return Response.json({ error: "unavailable" }, { status: 503 }); })
      .mockImplementationOnce(async (input, init) => { vi.useRealTimers(); return await preScanReply()(input, init); })
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const result = runScan({ cwd: dir, quiet: true, upload: true });
    await firstAsk;
    await vi.advanceTimersByTimeAsync(1_000);
    const uploaded = await result;
    expect(uploaded.upload).toBe("ok");
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    expect(stderr()).toBe("");
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      "https://h.example/api/scans/preflight",
      "https://h.example/api/scans/preflight",
      "https://h.example/api/scans",
      "https://h.example/api/scans/uploads/U1",
    ]);
  });

  it("stops before scanning when it can't reach the dashboard", async () => {
    const dir = setupConsumer();
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND h.example"), { code: "ENOTFOUND" });
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("fetch failed", { cause }));
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(stderr()).toBe("Error: Couldn't reach https://h.example. Check your connection and try again.\n");
    expect(scanExitCode(result)).toBe(1);
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
  });
});

describe("scanExitCode", () => {
  it("returns 2 when the scan produced no output", () => {
    expect(scanExitCode({ output: null, upload: "skipped" })).toBe(2);
  });
});
