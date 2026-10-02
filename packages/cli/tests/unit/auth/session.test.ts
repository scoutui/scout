import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore, type Store } from "../../../src/auth/store.js";
import {
  resolveHost,
  getStoredSession,
  setStoredSession,
  removeStoredSession,
  NotSignedInError,
  ReloginRequiredError,
  HostUnavailableError,
  formatAuthError,
} from "../../../src/auth/session.js";

let dir: string;
let file: string;
const BASE = "https://h.example";
const OTHER = "https://other.example";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cc-session-"));
  file = join(dir, "hosts.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function signedIn(): Store {
  return {
    default: OTHER,
    hosts: {
      [BASE]: { token: "scout_u_one", userEmail: "ben@example.com" },
      [OTHER]: { token: "scout_u_two", userEmail: "alice@example.com" },
    },
  };
}

describe("resolveHost", () => {
  const store: Store = { default: "https://default.example", hosts: {} };
  it("prefers flag, then env, then config, then default", () => {
    expect(resolveHost({ flagHost: "flag.example", configHost: "config.example", env: { SCOUTUI_HOST: "env.example" }, store })).toBe("https://flag.example");
    expect(resolveHost({ configHost: "config.example", env: { SCOUTUI_HOST: "env.example" }, store })).toBe("https://env.example");
    expect(resolveHost({ configHost: "config.example", env: {}, store })).toBe("https://config.example");
    expect(resolveHost({ env: {}, store })).toBe("https://default.example");
  });
  it("lets SCOUTUI_HOST override a committed repo config host", () => {
    expect(resolveHost({ configHost: "committed.example", env: { SCOUTUI_HOST: "ci.example" }, store: { hosts: {} } })).toBe("https://ci.example");
  });
  it("treats an empty SCOUTUI_HOST as unset", () => {
    expect(resolveHost({ configHost: "config.example", env: { SCOUTUI_HOST: "" }, store })).toBe("https://config.example");
    expect(resolveHost({ env: { SCOUTUI_HOST: "" }, store })).toBe("https://default.example");
  });
});

describe("stored sessions", () => {
  it("returns the selected session without changing file bytes, including during parallel reads", async () => {
    await saveStore(signedIn(), file);
    const original = await readFile(file, "utf8");
    const results = await Promise.all(Array.from({ length: 12 }, () => getStoredSession(BASE, { filePath: file })));
    expect(results).toEqual(Array.from({ length: 12 }, () => ({ token: "scout_u_one", userEmail: "ben@example.com" })));
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects a missing or legacy host entry", async () => {
    await saveStore({ hosts: {} }, file);
    await expect(getStoredSession(BASE, { filePath: file })).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("removes only a selected non-default host", async () => {
    await saveStore(signedIn(), file);
    await removeStoredSession(BASE, { filePath: file, expectedToken: "scout_u_one" });
    expect(await loadStore(file)).toEqual({ default: OTHER, hosts: { [OTHER]: { token: "scout_u_two", userEmail: "alice@example.com" } } });
  });

  it("clears the default when its host is removed", async () => {
    await saveStore(signedIn(), file);
    await removeStoredSession(OTHER, { filePath: file, expectedToken: "scout_u_two" });
    expect((await loadStore(file)).default).toBeUndefined();
  });

  it("keeps a replacement session when an older token is removed", async () => {
    await saveStore(signedIn(), file);
    await setStoredSession(BASE, { token: "scout_u_new", userEmail: "new@example.com" }, { filePath: file });
    const original = await readFile(file, "utf8");
    expect(await removeStoredSession(BASE, { filePath: file, expectedToken: "scout_u_one" })).toBe(false);
    expect(await readFile(file, "utf8")).toBe(original);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_new", userEmail: "new@example.com" });
  });

  it("keeps concurrent host additions and the unrelated default", async () => {
    await saveStore(signedIn(), file);
    await Promise.all(Array.from({ length: 12 }, (_unused, index) =>
      setStoredSession(`https://host-${index}.example`, { token: `scout_u_${index}`, userEmail: `${index}@example.com` }, { filePath: file })));
    const store = await loadStore(file);
    expect(store.default).toBe(OTHER);
    expect(Object.keys(store.hosts)).toHaveLength(14);
    expect(store.hosts[BASE]).toEqual({ token: "scout_u_one", userEmail: "ben@example.com" });
    for (let index = 0; index < 12; index++) {
      expect(store.hosts[`https://host-${index}.example`]).toEqual({ token: `scout_u_${index}`, userEmail: `${index}@example.com` });
    }
  });

});

describe("formatAuthError", () => {
  it("returns actionable auth messages and ignores unrelated errors", () => {
    expect(formatAuthError(new NotSignedInError(BASE))).toMatch(/auth login/);
    expect(formatAuthError(new ReloginRequiredError(BASE))).toMatch(/auth login/);
    expect(formatAuthError(new HostUnavailableError(BASE))).toBe(`Couldn't reach ${BASE}. Check your connection and try again.`);
    expect(formatAuthError(new Error("some other error"))).toBeNull();
  });
});
