import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "@scoutui/scan-format";
import { loadStore, saveStore, type Store } from "../../../src/auth/store.js";
import { runAuthLogin, runAuthStatus, runAuthLogout, runAuth } from "../../../src/commands/auth.js";
import * as client from "../../../src/auth/client.js";
import * as browser from "../../../src/auth/browser.js";
import { systemKeychain } from "../../../src/auth/keychain.js";
import { fakeKeychain } from "./fake-keychain.js";
import { Logger } from "../../../src/util/log.js";
import { createColor } from "../../../src/util/style.js";

let dir: string;
let file: string;
const BASE = "https://h.example";
const USER_TOKEN = `scout_u_${"a".repeat(43)}`;
const REPLACEMENT_TOKEN = `scout_u_${"b".repeat(43)}`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cc-login-"));
  file = join(dir, "hosts.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Collects what's written to stderr from here on. */
function captureStderr(): string[] {
  const errors: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);
  return errors;
}

const UNEXPECTED_REPLY = "sent an unexpected reply. Check that it's your Scout dashboard and that the CLI is up to date.";
const plain = { color: createColor({ isTTY: false, env: {} }) };

const deviceCode = {
  deviceCode: "dc",
  userCode: "ABCD-EFGH",
  verificationUri: `${BASE}/login/device`,
  verificationUriComplete: `${BASE}/login/device?code=ABCD-EFGH`,
  expiresIn: 600,
  interval: 5,
  warning: null,
};

describe("runAuthLogin", () => {
  it("rejects malformed token success without changing another host's stored credential", async () => {
    const other = "https://other.example";
    await saveStore({ default: other, hosts: { [other]: { token: `scout_u_${"b".repeat(43)}`, userEmail: "alice@example.com" } } }, file);
    const original = await readFile(file, "utf8");
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    vi.spyOn(global, "fetch").mockResolvedValue(Response.json({ access_token: "scout_u_short", token_type: "Bearer", email: "ben@example.com" }));
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);
    expect(await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0 })).toBe(1);
    expect(await readFile(file, "utf8")).toBe(original);
    expect(errors.join("")).toBe(`Error: Couldn't sign in: ${BASE} ${UNEXPECTED_REPLY}\n`);
  });

  it.each([
    ["null", null],
    ["missing user ID", { email: "ben@example.com" }],
    ["invalid email", { userId: "u1", email: 123 }],
  ])("keeps a valid stored session after a malformed 200 whoami response (%s)", async (_label, body) => {
    await saveStore(signedIn(), file);
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const device = vi.spyOn(client, "requestDeviceCode").mockRejectedValue(new Error("device flow must not start"));
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);
    expect(await runAuthLogin({ host: BASE, store: { filePath: file } })).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_abc", userEmail: "ben@example.com" });
    expect(device).not.toHaveBeenCalled();
    expect(errors.join("")).toBe(`Error: Couldn't sign in: ${BASE} ${UNEXPECTED_REPLY}\n`);
  });

  it("reuses a validated session without requesting a device code, and says which role the dashboard gives it", async () => {
    await saveStore(signedIn(), file);
    const who = vi.spyOn(client, "whoami").mockResolvedValue({ userId: "u1", email: "ben@example.com", role: "admin" });
    const device = vi.spyOn(client, "requestDeviceCode");
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { lines.push(s); return true; }) as typeof process.stdout.write);
    expect(await runAuthLogin({ host: BASE, store: { filePath: file } })).toBe(0);
    expect(who).toHaveBeenCalledWith(BASE, "scout_u_abc");
    expect(device).not.toHaveBeenCalled();
    expect(lines.join("")).toBe(`Already signed in as ben@example.com to ${BASE} as an Admin.\n`);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_abc", userEmail: "ben@example.com" });
  });

  it.each([
    ["makes it the default dashboard when there's none", undefined, BASE],
    ["leaves another default dashboard as it is", "https://other.example", "https://other.example"],
  ])("reuses a validated session and %s", async (_, before, after) => {
    const hosts = { ...signedIn().hosts, "https://other.example": { token: "scout_u_other", userEmail: "a@example.com" } };
    await saveStore({ ...(before !== undefined ? { default: before } : {}), hosts }, file);
    vi.spyOn(client, "whoami").mockResolvedValue({ userId: "u1", email: "ben@example.com", role: null });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await runAuthLogin({ host: BASE, store: { filePath: file } })).toBe(0);
    expect(await loadStore(file)).toEqual({ default: after, hosts });
  });

  it("clears a confirmed invalid session for only the selected host before device login", async () => {
    const other = "https://other.example";
    await saveStore({ default: other, hosts: { ...signedIn().hosts, [other]: { token: "scout_u_other", userEmail: "a@example.com" } } }, file);
    vi.spyOn(client, "whoami").mockResolvedValue(null);
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "denied" });
    expect(await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0 })).toBe(1);
    expect(await loadStore(file)).toEqual({ default: other, hosts: { [other]: { token: "scout_u_other", userEmail: "a@example.com" } } });
  });

  it.each(["http", "transport"])("retains a stored session when whoami has a %s failure", async (mode) => {
    await saveStore(signedIn(), file);
    vi.spyOn(client, "whoami").mockRejectedValue(mode === "http" ? new client.AuthHttpError(500, "whoami failed") : new Error("network down"));
    const device = vi.spyOn(client, "requestDeviceCode");
    expect(await runAuthLogin({ host: BASE, store: { filePath: file } })).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_abc", userEmail: "ben@example.com" });
    expect(device).not.toHaveBeenCalled();
  });

  it("prints credential-lock recovery guidance when an invalid session cannot be removed", async () => {
    await saveStore(signedIn(), file);
    const original = await readFile(file, "utf8");
    await writeFile(`${file}.lock`, "held", { mode: 0o600 });
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(() => { tick += 1_000; return tick; });
    vi.spyOn(client, "whoami").mockResolvedValue(null);
    const device = vi.spyOn(client, "requestDeviceCode").mockRejectedValue(new Error("device flow must not start"));
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);

    expect(await runAuthLogin({ host: BASE, store: { filePath: file } })).toBe(1);
    expect(errors.join("")).toContain(`${file}.lock`);
    expect(errors.join("")).toMatch(/If none is running, delete .*\.lock/i);
    expect(errors.join("")).not.toMatch(/could not reach/i);
    expect(device).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("polls until approved, stores one session, and sets the default host", async () => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken")
      .mockResolvedValueOnce({ kind: "pending" })
      .mockResolvedValueOnce({
        kind: "session",
        session: { token: USER_TOKEN, email: "ben@example.com", role: null },
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep, now: () => 0 });
    expect(code).toBe(0);
    const stored = (await loadStore(file)).hosts[BASE];
    expect(stored).toEqual({ token: USER_TOKEN, userEmail: "ben@example.com" });
    expect((await loadStore(file)).default).toBe(BASE);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("warns on stderr only when login stores the token in hosts.json", async () => {
    const fake = fakeKeychain();
    vi.mocked(systemKeychain).mockReturnValue(fake.keychain);
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "session", session: { token: USER_TOKEN, email: "ben@example.com", role: null } });
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);

    expect(await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0 })).toBe(0);
    expect(errors.join("")).not.toContain("Warning:");
    expect(fake.entries.get(BASE)).toBe(USER_TOKEN);

    vi.mocked(systemKeychain).mockReset();
    expect(await runAuthLogin({ host: "https://other.example", store: { filePath: file }, sleep: async () => {}, now: () => 0 })).toBe(0);
    expect(errors.join("")).toContain(`Warning: Couldn't save your session to the system keychain, so it was saved to ${file} instead.\n`);
  });

  it("shows a hosts.json path under the home directory with ~", async () => {
    vi.stubEnv("HOME", dir);
    try {
      vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
      vi.spyOn(browser, "openBrowser").mockReturnValue(false);
      vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "session", session: { token: USER_TOKEN, email: "ben@example.com", role: null } });
      const errors: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);
      expect(await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0 })).toBe(0);
      expect(errors.join("")).toContain("so it was saved to ~/hosts.json instead.");

      vi.spyOn(client, "whoami").mockResolvedValue({ userId: "u1", email: "ben@example.com", role: null });
      const lines: string[] = [];
      expect(await runAuthStatus({ host: BASE, store: { filePath: file }, env: {}, write: (s) => lines.push(s) })).toBe(0);
      expect(lines.join("")).toContain("(session saved in ~/hosts.json).");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("widens the interval on slow_down", async () => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken")
      .mockResolvedValueOnce({ kind: "slow_down" })
      .mockResolvedValueOnce({ kind: "session", session: { token: USER_TOKEN, email: "x@y.z", role: null } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runAuthLogin({ host: BASE, store: { filePath: file }, sleep, now: () => 0 });
    expect(sleep).toHaveBeenNthCalledWith(2, 10_000);
  });

  it("returns 1 and stores nothing when the device code expires", async () => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "expired" });
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now: () => 0 });
    expect(code).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toBeUndefined();
  });

  it("returns 1 and stores nothing when authorization is denied", async () => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "denied" });
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now: () => 0 });
    expect(code).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toBeUndefined();
  });

  it("returns 1 when the overall deadline is exceeded", async () => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "pending" });
    let t = 0;
    const now = () => {
      const v = t;
      t += 700_000; // first call (deadline calc) = 0; next while-check exceeds deadline (600000)
      return v;
    };
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now });
    expect(code).toBe(1);
  });

  it("reports an HTTP failure from device-code as a server error, not a network problem", async () => {
    const { AuthHttpError } = await import("../../../src/auth/client.js");
    vi.spyOn(client, "requestDeviceCode").mockRejectedValue(new AuthHttpError(500, "device-code failed"));
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errs.push(s); return true; }) as typeof process.stderr.write);
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now: () => 0 });
    spy.mockRestore();
    expect(code).toBe(1);
    expect(errs.join("")).toBe(`Error: Couldn't sign in: ${BASE} returned an error. Check the address and try again.\n`);
  });

  it.each([false, true])("says it couldn't reach the host when the device-code request fails, with the network error only under debug (%s)", async (debug) => {
    const cause = Object.assign(new Error("connect ECONNREFUSED ::1:3000"), { code: "ECONNREFUSED" });
    vi.spyOn(client, "requestDeviceCode").mockRejectedValue(new TypeError("fetch failed", { cause }));
    const errs = captureStderr();
    const log = new Logger({ debug, ...plain });
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now: () => 0, log });
    expect(code).toBe(1);
    expect(errs.join("")).toBe(`Error: Couldn't reach ${BASE}. Check your connection and try again.\n${debug ? "ECONNREFUSED\n" : ""}`);
  });

  it("reports an HTTP failure while polling as a server error", async () => {
    const { AuthHttpError } = await import("../../../src/auth/client.js");
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockRejectedValue(new AuthHttpError(500, "server_error"));
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errs.push(s); return true; }) as typeof process.stderr.write);
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now: () => 0 });
    spy.mockRestore();
    expect(code).toBe(1);
    expect(errs.join("")).toBe(`Error: Couldn't sign in: ${BASE} returned an error. Run scout auth login again.\n`);
    expect((await loadStore(file)).hosts[BASE]).toBeUndefined();
  });

  it("surfaces the transport cause when polling cannot reach the host", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND h.example"), { code: "ENOTFOUND" });
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockRejectedValue(new TypeError("fetch failed", { cause }));
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errs.push(s); return true; }) as typeof process.stderr.write);
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: vi.fn().mockResolvedValue(undefined), now: () => 0 });
    spy.mockRestore();
    expect(code).toBe(1);
    expect(errs.join("")).toBe(`Error: Couldn't reach ${BASE}. Check your connection, then run scout auth login again.\n`);
  });

  it("tells the dashboard which scan format the CLI writes, and prints its refusal with the page about versions", async () => {
    const message = "Couldn't sign in: this CLI is too old for the dashboard. Upgrade the CLI to 0.2.0, or run npx @scoutui/cli@0.2.0 auth login.";
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json({ error: "unsupported_version", message }, { status: 409 }));
    const open = vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    const errs = captureStderr();
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0, log: new Logger(plain) });
    expect(code).toBe(1);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ scanVersion: SCHEMA_VERSION });
    expect(errs.join("")).toBe(`Error: ${message} See https://scoutui.dev/docs/guides/upgrade-scout#version-messages\n`);
    expect(open).not.toHaveBeenCalled();
  });

  it("says the dashboard returned an error when it refuses the sign-in with a reply it can't read", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("<html>refused</html>", { status: 409 }));
    const errs = captureStderr();
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0, log: new Logger(plain) });
    expect(code).toBe(1);
    expect(errs.join("")).toBe(`Error: Couldn't sign in: ${BASE} returned an error. Try again later.\n`);
  });

  it.each([
    [false, `Waiting for approval… ✓ Signed in as ben@example.com to ${BASE}.\n`, ""],
    [true, `✓ Signed in as ben@example.com to ${BASE}.\n`, "\r⠋ Waiting for approval…\x1b[K\r\x1b[K"],
  ])("waits for approval with a spinner on stderr only when styled, then says who it signed in as and where (styled: %s)", async (styled, end, stderr) => {
    vi.mocked(systemKeychain).mockReturnValue(fakeKeychain().keychain);
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "session", session: { token: USER_TOKEN, email: "ben@example.com", role: null } });
    const errs = captureStderr();
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { lines.push(s); return true; }) as typeof process.stdout.write);
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0, log: new Logger({ ...plain, styled }) });
    expect(code).toBe(0);
    expect(lines.join("")).toBe(`To sign in, open:\n  ${BASE}/login/device?code=ABCD-EFGH\nCode: ABCD-EFGH\n${end}`);
    expect(errs.join("")).toBe(stderr);
  });

  it.each([
    ["editor", " as an Editor"],
    ["no role", ""],
  ])("says which role the dashboard gave the account when it signs in (%s)", async (role, as) => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    vi.spyOn(global, "fetch").mockResolvedValue(Response.json({
      access_token: USER_TOKEN, token_type: "Bearer", email: "ben@example.com", ...(role === "no role" ? {} : { role }),
    }));
    captureStderr();
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { lines.push(s); return true; }) as typeof process.stdout.write);
    expect(await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0, log: new Logger(plain) })).toBe(0);
    expect(lines.at(-1)).toBe(`✓ Signed in as ben@example.com to ${BASE}${as}.\n`);
  });

  it("prints the dashboard's warning line before the sign-in steps", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(Response.json({
      device_code: "dc", user_code: "ABCD-EFGH", verification_uri: `${BASE}/login/device`,
      verification_uri_complete: `${BASE}/login/device?code=ABCD-EFGH`, expires_in: 600, interval: 5, warning: "A line from the dashboard.",
    }, { status: 201 }));
    vi.spyOn(browser, "openBrowser").mockReturnValue(false);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "session", session: { token: USER_TOKEN, email: "ben@example.com", role: null } });
    const writes = captureStderr();
    vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { writes.push(s); return true; }) as typeof process.stdout.write);
    const code = await runAuthLogin({ host: BASE, store: { filePath: file }, sleep: async () => {}, now: () => 0, log: new Logger(plain) });
    expect(code).toBe(0);
    expect(writes[0]).toBe("Warning: A line from the dashboard.\n");
    expect(writes[1]).toBe(`To sign in, open:\n  ${BASE}/login/device?code=ABCD-EFGH\nCode: ABCD-EFGH\n`);
  });
});

function signedIn(): Store {
  return {
    default: BASE,
    hosts: { [BASE]: { token: "scout_u_abc", userEmail: "ben@example.com" } },
  };
}

describe("runAuthStatus", () => {
  it("prints credential-lock recovery guidance when an invalid session cannot be removed", async () => {
    await saveStore(signedIn(), file);
    const original = await readFile(file, "utf8");
    await writeFile(`${file}.lock`, "held", { mode: 0o600 });
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(() => { tick += 1_000; return tick; });
    vi.spyOn(client, "whoami").mockResolvedValue(null);
    const lines: string[] = [];
    const errors = captureStderr();

    expect(await runAuthStatus({ store: { filePath: file }, env: {}, write: (s) => lines.push(s) })).toBe(1);
    expect(lines).toEqual([]);
    expect(errors.join("")).toBe(
      `Error: Another scout command is using your saved sign-in. Try again when it finishes. If none is running, delete ${file}.lock.\n`,
    );
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("does not clear a replacement login after a delayed 401 for the prior token", async () => {
    await saveStore(signedIn(), file);
    let signalStarted: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(client, "whoami").mockImplementation(async () => { signalStarted(); await held; return null; });
    const lines: string[] = [];
    const errors = captureStderr();
    const status = runAuthStatus({ store: { filePath: file }, env: {}, write: (s) => lines.push(s) });
    await started;
    await saveStore({ default: BASE, hosts: { [BASE]: { token: REPLACEMENT_TOKEN, userEmail: "new@example.com" } } }, file);
    release();
    expect(await status).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: REPLACEMENT_TOKEN, userEmail: "new@example.com" });
    expect(lines).toEqual([]);
    expect(errors.join("")).toBe(`Error: Your sign-in changed while checking it. Run scout auth status --host ${BASE} again.\n`);
  });

  it.each([
    ["null", null],
    ["missing user ID", { email: "ben@example.com" }],
    ["invalid email", { userId: "u1", email: 123 }],
  ])("preserves the session after a malformed 200 whoami response (%s)", async (_label, body) => {
    await saveStore(signedIn(), file);
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const lines: string[] = [];
    const errors = captureStderr();
    expect(await runAuthStatus({ store: { filePath: file }, env: {}, write: (s) => lines.push(s) })).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_abc", userEmail: "ben@example.com" });
    expect(lines).toEqual([]);
    expect(errors.join("")).toBe(`Error: Couldn't check your session: ${BASE} ${UNEXPECTED_REPLY}\n`);
  });

  it.each([
    ["viewer", " as a Viewer"],
    ["no role", ""],
    ["owner", ""],
  ])("reports who is signed in and the role the dashboard gives them, when it sends one Scout knows (%s)", async (role, as) => {
    await saveStore(signedIn(), file);
    vi.spyOn(global, "fetch").mockResolvedValue(Response.json({ userId: "u1", email: "ben@example.com", ...(role === "no role" ? {} : { role }) }));
    const logs: string[] = [];
    const code = await runAuthStatus({ store: { filePath: file }, env: {}, write: (s) => logs.push(s) });
    expect(code).toBe(0);
    expect(logs).toEqual([`Signed in as ben@example.com to ${BASE}${as} (session saved in ${file}).\n`]);
  });

  it("shows whether the token is stored in the keychain or hosts.json", async () => {
    const other = "https://other.example";
    const fake = fakeKeychain();
    vi.mocked(systemKeychain).mockReturnValue(fake.keychain);
    await saveStore(signedIn(), file, fake.keychain);
    await saveStore(
      { default: BASE, hosts: { ...signedIn().hosts, [other]: { token: "scout_u_other", userEmail: "a@example.com" } } },
      file,
      { ...fake.keychain, set: async () => false },
    );
    vi.spyOn(client, "whoami").mockResolvedValue({ userId: "u1", email: "ben@example.com", role: null });
    const lines: string[] = [];

    expect(await runAuthStatus({ host: BASE, store: { filePath: file }, env: {}, write: (s) => lines.push(s) })).toBe(0);
    expect(await runAuthStatus({ host: other, store: { filePath: file }, env: {}, write: (s) => lines.push(s) })).toBe(0);
    expect(lines).toEqual([
      `Signed in as ben@example.com to ${BASE} (session saved in the system keychain).\n`,
      `Signed in as ben@example.com to ${other} (session saved in ${file}).\n`,
    ]);
  });

  it("reports not-signed-in when there is no entry", async () => {
    await saveStore({ hosts: {} }, file);
    const logs: string[] = [];
    const code = await runAuthStatus({ host: BASE, store: { filePath: file }, env: {}, write: (s) => logs.push(s) });
    expect(code).toBe(1);
    expect(logs.join("")).toMatch(/not signed in to/i);
  });
});

describe("runAuthLogout", () => {
  it("does not clear a replacement login after a delayed revocation of the prior token", async () => {
    await saveStore(signedIn(), file);
    let signalStarted: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(client, "revokeSession").mockImplementation(async () => { signalStarted(); await held; });
    const lines: string[] = [];
    const logout = runAuthLogout({ host: BASE, store: { filePath: file }, env: {}, write: (s) => lines.push(s) });
    await started;
    await saveStore({ default: BASE, hosts: { [BASE]: { token: REPLACEMENT_TOKEN, userEmail: "new@example.com" } } }, file);
    release();
    expect(await logout).toBe(0);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: REPLACEMENT_TOKEN, userEmail: "new@example.com" });
    expect(lines.join("")).toMatch(/Your newer sign-in is kept/i);
  });

  it("deletes the stored entry and clears it as default", async () => {
    await saveStore(signedIn(), file);
    const revoke = vi.spyOn(client, "revokeSession").mockImplementation(async () => {
      expect((await loadStore(file)).hosts[BASE]).toBeDefined();
    });
    const code = await runAuthLogout({ host: BASE, store: { filePath: file }, env: {} });
    expect(code).toBe(0);
    expect(revoke).toHaveBeenCalledWith(BASE, "scout_u_abc");
    const after = await loadStore(file);
    expect(after.hosts[BASE]).toBeUndefined();
    expect(after.default).toBeUndefined();
  });

  it("prints a confirmation message via the injectable write", async () => {
    await saveStore(signedIn(), file);
    vi.spyOn(client, "revokeSession").mockResolvedValue();
    const logs: string[] = [];
    const code = await runAuthLogout({ host: BASE, store: { filePath: file }, env: {}, write: (s) => logs.push(s) });
    expect(code).toBe(0);
    expect(logs.join("")).toMatch(/signed out of/i);
  });

  it.each(["http", "transport"])("keeps the session when remote revocation has a %s failure", async (mode) => {
    await saveStore(signedIn(), file);
    vi.spyOn(client, "revokeSession").mockRejectedValue(mode === "http" ? new client.AuthHttpError(500, "server error") : new Error("network down"));
    const logs: string[] = [];
    const errors = captureStderr();
    expect(await runAuthLogout({ host: BASE, store: { filePath: file }, env: {}, write: (s) => logs.push(s) })).toBe(1);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_abc", userEmail: "ben@example.com" });
    expect(logs).toEqual([]);
    expect(errors.join("")).toBe(mode === "http"
      ? `Error: Couldn't sign out of ${BASE}: it returned an error. Try again later.\n`
      : `Error: Couldn't reach ${BASE} to sign out. Check your connection and try again.\n`);
  });

  it("leaves other hosts and their default when revoking a non-default host", async () => {
    const other = "https://other.example";
    await saveStore({ default: other, hosts: { ...signedIn().hosts, [other]: { token: "scout_u_other", userEmail: "a@example.com" } } }, file);
    vi.spyOn(client, "revokeSession").mockResolvedValue();
    expect(await runAuthLogout({ host: BASE, store: { filePath: file }, env: {} })).toBe(0);
    expect(await loadStore(file)).toEqual({ default: other, hosts: { [other]: { token: "scout_u_other", userEmail: "a@example.com" } } });
  });

  it("succeeds locally without HTTP when no session is stored", async () => {
    const revoke = vi.spyOn(client, "revokeSession");
    expect(await runAuthLogout({ host: BASE, store: { filePath: file }, env: {} })).toBe(0);
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe("runAuth dispatcher", () => {
  it.each([
    [["bogus"], "Error: Unknown auth command 'bogus'. Use scout auth login, logout or status.\n"],
    [[], "Error: Choose an auth command: scout auth login, logout or status.\n"],
  ])("rejects auth %j with exit 2 and names the commands", async (argv, line) => {
    const errors = captureStderr();
    expect(await runAuth(argv, { env: {}, store: { filePath: file } })).toBe(2);
    expect(errors.join("")).toBe(line);
  });
  it("requires a host for login, and says how to give one", async () => {
    const errors = captureStderr();
    expect(await runAuth(["login"], { env: {}, store: { filePath: file } })).toBe(2);
    expect(errors.join("")).toBe("Error: Couldn't sign in: no dashboard address is set. Run scout auth login --host <url>, or set SCOUTUI_HOST.\n");
  });

  it("refuses to sign in to a plain http host and says why", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);
    expect(await runAuth(["login", "--host", "http://h.example"], { env: {}, store: { filePath: file } })).toBe(2);
    expect(errors.join("")).toBe("Error: http://h.example doesn't use https://, so your sign-in would be sent unencrypted. Use the dashboard's https:// address. Plain http:// works only for localhost.\n");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delegates `status` and returns its exit code", async () => {
    await saveStore(signedIn(), file);
    vi.spyOn(client, "whoami").mockResolvedValue({ userId: "u1", email: "ben@example.com", role: null });
    expect(await runAuth(["status"], { env: {}, store: { filePath: file } })).toBe(0);
  });

  it("`status` reports on the dashboard the config names, not the saved default", async () => {
    const other = "https://other.example";
    await saveStore({ default: other, hosts: { ...signedIn().hosts, [other]: { token: "scout_u_other", userEmail: "ben@example.com" } } }, file);
    await writeFile(join(dir, "scout.config.json"), JSON.stringify({ include: ["src/**"], host: BASE }));
    const who = vi.spyOn(client, "whoami").mockResolvedValue({ userId: "u1", email: "ben@example.com", role: null });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runAuth(["status"], { env: {}, cwd: dir, store: { filePath: file } })).toBe(0);
    expect(who).toHaveBeenCalledWith(BASE, "scout_u_abc");
  });

  it("stops with the config's own error when the config can't be read", async () => {
    await writeFile(join(dir, "scout.config.json"), JSON.stringify({ include: ["src/**"], hots: BASE }));
    const errors = captureStderr();
    expect(await runAuth(["status"], { env: {}, cwd: dir, store: { filePath: file } })).toBe(2);
    expect(errors.join("")).toBe(`Error: ${join(dir, "scout.config.json")} has a field Scout doesn't use: "hots". Remove it and try again.\n`);
  });

  it("delegates `logout --host` and clears the entry", async () => {
    await saveStore(signedIn(), file);
    vi.spyOn(client, "revokeSession").mockResolvedValue();
    expect(await runAuth(["logout", "--host", BASE], { env: {}, store: { filePath: file } })).toBe(0);
    expect((await loadStore(file)).hosts[BASE]).toBeUndefined();
  });
});
