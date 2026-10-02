import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { systemKeychain, type Run, type RunResult } from "../../../src/auth/keychain.js";

vi.unmock("../../../src/auth/keychain.js");

const HOST = "https://h.example";
const TOKEN = `scout_u_${"a".repeat(43)}`;
const HEX = Buffer.from(TOKEN, "utf8").toString("hex");

function recorder(result: RunResult = { ok: true, stdout: "" }) {
  const calls: { command: string; args: string[]; input: string | undefined }[] = [];
  const exec: Run = async (command, args, input) => {
    calls.push({ command, args, input });
    return result;
  };
  return { calls, exec };
}

describe.each(["darwin", "linux"] as const)("%s keychain", (platform) => {
  it("passes the token on stdin and never as an argument", async () => {
    const { calls, exec } = recorder();
    expect(await systemKeychain(platform, exec).set(HOST, TOKEN)).toBe(true);
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain(TOKEN);
      expect(call.args.join(" ")).not.toContain(HEX);
    }
    expect(calls.map((call) => call.input ?? "").join("")).toContain(platform === "darwin" ? HEX : TOKEN);
  });

  it("reads a stored token", async () => {
    expect(await systemKeychain(platform, recorder({ ok: true, stdout: `${TOKEN}\n` }).exec).get(HOST)).toBe(TOKEN);
  });

  it("reports a failing tool as no token and a failed store", async () => {
    const keychain = systemKeychain(platform, recorder({ ok: false, stdout: `${TOKEN}\n` }).exec);
    expect(await keychain.get(HOST)).toBeUndefined();
    expect(await keychain.set(HOST, TOKEN)).toBe(false);
  });
});

it("refuses a macOS host that cannot be quoted on the security command line", async () => {
  const { calls, exec } = recorder();
  const keychain = systemKeychain("darwin", exec);
  expect(await keychain.set('https://h.example" -A', TOKEN)).toBe(false);
  expect(await keychain.set("https://h.example\ndelete-keychain", TOKEN)).toBe(false);
  expect(await keychain.set("https://h.example\\x", TOKEN)).toBe(false);
  expect(await keychain.set("https://bücher.example", TOKEN)).toBe(false);
  expect(calls).toEqual([]);
});

it("refuses a macOS write longer than one security command line", async () => {
  const { calls, exec } = recorder();
  expect(await systemKeychain("darwin", exec).set(`https://${"a".repeat(4100)}`, TOKEN)).toBe(false);
  expect(calls).toEqual([]);
});

it("has no keychain on Windows", async () => {
  const { calls, exec } = recorder();
  const keychain = systemKeychain("win32", exec);
  expect(await keychain.set(HOST, TOKEN)).toBe(false);
  expect(await keychain.get(HOST)).toBeUndefined();
  expect(calls).toEqual([]);
});

describe.runIf(process.env.SCOUTUI_KEYCHAIN_TEST === "1")("system keychain round trip", () => {
  it("stores, replaces, reads and deletes a token", async () => {
    const keychain = systemKeychain();
    const host = `https://keychain-test-${randomUUID()}.invalid`;
    try {
      expect(await keychain.set(host, "scout_u_first")).toBe(true);
      expect(await keychain.set(host, TOKEN)).toBe(true);
      expect(await keychain.get(host)).toBe(TOKEN);
    } finally {
      await keychain.delete(host);
    }
    expect(await keychain.get(host)).toBeUndefined();
  });
});
