import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, stat, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadStore, saveStore, mutateStore, normalizeHost, type Store } from "../../../src/auth/store.js";
import type { Keychain } from "../../../src/auth/keychain.js";
import { fakeKeychain } from "./fake-keychain.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open) };
});

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cc-store-"));
  file = join(dir, "hosts.json");
});
afterEach(async () => {
  vi.mocked(fs.rename).mockClear();
  vi.mocked(fs.rename).mockImplementation((await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).rename);
  vi.mocked(fs.open).mockClear();
  vi.mocked(fs.open).mockImplementation((await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open);
  await rm(dir, { recursive: true, force: true });
});

describe("normalizeHost", () => {
  it("prepends https:// when no scheme", () => {
    expect(normalizeHost("scout.example.com")).toBe("https://scout.example.com");
  });
  it("strips trailing slashes and keeps explicit scheme", () => {
    expect(normalizeHost("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeHost("https://h.example/")).toBe("https://h.example");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeHost("  h.example  ")).toBe("https://h.example");
  });
  it("throws on empty/blank input", () => {
    expect(() => normalizeHost("   ")).toThrow(/empty/i);
  });
  it.each(["http://127.0.0.1:3000", "http://[::1]:3000"])("accepts plain http for this computer: %s", (host) => {
    expect(normalizeHost(host)).toBe(host);
  });
  it.each(["http://scout.example.com", "ftp://scout.example.com"])("rejects %s, which isn't https", (host) => {
    expect(() => normalizeHost(host)).toThrow(`${host} doesn't use https://, so your sign-in would be sent unencrypted. Use the dashboard's https:// address. Plain http:// works only for localhost.`);
  });
});

describe("loadStore / saveStore", () => {
  it("returns an empty store when the file is missing", async () => {
    expect(await loadStore(file)).toEqual({ hosts: {} });
  });

  it("round-trips a store and writes mode 0600", async () => {
    const store: Store = {
      default: "https://h.example",
      hosts: {
        "https://h.example": {
          token: "scout_u_abc",
          userEmail: "ben@example.com",
        },
      },
    };
    await saveStore(store, file);
    expect(await loadStore(file)).toEqual(store);
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readdir(dir)).toEqual(["hosts.json"]);
  });

  it("re-tightens mode to 0600 on a pre-existing world-readable file", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file, "{}", { mode: 0o644 });
    await saveStore({ hosts: {} }, file);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("throws a clear error on corrupt JSON", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file, "{ not json", "utf8");
    await expect(loadStore(file)).rejects.toThrow(
      `Your saved sessions in ${file} can't be read. Delete the file and run scout auth login to sign in again.`,
    );
  });

  it("does not expose old access and refresh entries as sessions", async () => {
    await writeFile(file, JSON.stringify({ default: "https://h.example", hosts: {
      "https://h.example": { accessToken: "a", refreshToken: "r", expiresAt: "later", userEmail: "ben@example.com" },
    } }));
    expect((await loadStore(file)).hosts).toEqual({});
  });

  it("rejects entries missing a string token or email", async () => {
    await writeFile(file, JSON.stringify({ hosts: {
      "https://one.example": { token: 12, userEmail: "a@example.com" },
      "https://two.example": { token: "scout_u_x", userEmail: null },
    } }));
    expect((await loadStore(file)).hosts).toEqual({});
  });

  it("leaves the live file intact and removes the temporary file when replacement fails", async () => {
    const initial: Store = { default: "https://h.example", hosts: { "https://h.example": { token: "scout_u_old", userEmail: "ben@example.com" } } };
    await saveStore(initial, file);
    const original = await readFile(file, "utf8");
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename interrupted"));
    await expect(saveStore({ hosts: {} }, file)).rejects.toThrow("rename interrupted");
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readdir(dir)).toEqual(["hosts.json"]);
  });

  it("removes a newly acquired lock when writing its owner fails", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "writeFile") return async () => { throw new Error("owner write failed"); };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    await expect(saveStore({ hosts: {} }, file)).rejects.toThrow("owner write failed");
    expect(await readdir(dir)).toEqual([]);
  });

  it("waits for an in-progress file replacement before starting the next one", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let signalStarted: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
      signalStarted();
      await held;
      return await actual.rename(...args);
    });
    const first = saveStore({ hosts: { "https://one.example": { token: "one", userEmail: "one@example.com" } } }, file);
    await started;
    const second = saveStore({ hosts: { "https://two.example": { token: "two", userEmail: "two@example.com" } } }, file);
    await delay(75);
    expect(fs.rename).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(await readdir(dir)).toEqual(["hosts.json"]);
  });

  it("preserves all concurrent read-modify-write host additions", async () => {
    await saveStore({ default: "https://default.example", hosts: {
      "https://default.example": { token: "default", userEmail: "default@example.com" },
    } }, file);
    await Promise.all(Array.from({ length: 12 }, (_unused, index) => mutateStore((store) => {
      store.hosts[`https://host-${index}.example`] = { token: `token-${index}`, userEmail: `${index}@example.com` };
      return { changed: true, result: undefined };
    }, file)));
    const store = await loadStore(file);
    expect(store.default).toBe("https://default.example");
    expect(Object.keys(store.hosts)).toHaveLength(13);
  });

  it("times out on a held lock without changing the store or deleting the lock", async () => {
    await saveStore({ hosts: {} }, file);
    const original = await readFile(file, "utf8");
    await writeFile(`${file}.lock`, `${process.pid}:held`, { mode: 0o600 });
    const clock = vi.spyOn(Date, "now");
    let now = 0;
    clock.mockImplementation(() => { now += 1_000; return now; });
    try {
      await expect(saveStore({ hosts: { "https://new.example": { token: "new", userEmail: "new@example.com" } } }, file))
        .rejects.toThrow(`Another scout command is using your saved sign-in. Try again when it finishes. If none is running, delete ${file}.lock.`);
    } finally {
      clock.mockRestore();
    }
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readFile(`${file}.lock`, "utf8")).toBe(`${process.pid}:held`);
  });

  it("never removes an abandoned lock when two contenders time out", async () => {
    await saveStore({ default: "https://original.example", hosts: {
      "https://original.example": { token: "original", userEmail: "original@example.com" },
    } }, file);
    const original = await readFile(file, "utf8");
    await writeFile(`${file}.lock`, "99999999:stale", { mode: 0o600 });
    const clock = vi.spyOn(Date, "now");
    let now = 0;
    clock.mockImplementation(() => { now += 1_000; return now; });
    try {
      const results = await Promise.allSettled([
        saveStore({ hosts: { "https://first.example": { token: "first", userEmail: "first@example.com" } } }, file),
        mutateStore((store) => {
          store.hosts["https://second.example"] = { token: "second", userEmail: "second@example.com" };
          return { changed: true, result: undefined };
        }, file),
      ]);
      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      for (const result of results) {
        if (result.status === "rejected") expect(result.reason).toBeInstanceOf(Error);
      }
    } finally {
      clock.mockRestore();
    }
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readFile(`${file}.lock`, "utf8")).toBe("99999999:stale");
  });
});

const H = "https://h.example";
const O = "https://other.example";
const rawFile = async () => JSON.parse(await readFile(file, "utf8")) as unknown;
const addHost = (host: string, token: string, keychain: Keychain) => mutateStore((store) => {
  store.hosts[host] = { token, userEmail: "ben@example.com" };
  return { changed: true, result: undefined };
}, file, keychain);

describe("keychain storage", () => {
  it("stores the token in the keychain and keeps only the host and email in hosts.json", async () => {
    const { entries, keychain } = fakeKeychain();
    await saveStore({ default: H, hosts: { [H]: { token: "scout_u_abc", userEmail: "ben@example.com" } } }, file, keychain);
    expect(await rawFile()).toEqual({ default: H, hosts: { [H]: { userEmail: "ben@example.com" } } });
    expect(entries.get(H)).toBe("scout_u_abc");
    expect(await loadStore(file, keychain)).toEqual({ default: H, hosts: { [H]: { token: "scout_u_abc", userEmail: "ben@example.com" } } });
  });

  it("writes the token to hosts.json when no keychain is reachable", async () => {
    const { keychain } = fakeKeychain({ available: false });
    await saveStore({ hosts: { [H]: { token: "scout_u_abc", userEmail: "ben@example.com" } } }, file, keychain);
    expect(await rawFile()).toEqual({ hosts: { [H]: { token: "scout_u_abc", userEmail: "ben@example.com" } } });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await loadStore(file, keychain)).hosts[H]?.token).toBe("scout_u_abc");
  });

  it("keeps reading an inline hosts.json token and leaves it in place when another host signs in", async () => {
    const { entries, keychain } = fakeKeychain();
    await writeFile(file, JSON.stringify({ default: H, hosts: { [H]: { token: "scout_u_inline", userEmail: "ben@example.com" } } }));
    await addHost(O, "scout_u_other", keychain);
    expect(await rawFile()).toEqual({ default: H, hosts: {
      [H]: { token: "scout_u_inline", userEmail: "ben@example.com" },
      [O]: { userEmail: "ben@example.com" },
    } });
    expect([...entries.keys()]).toEqual([O]);
    expect((await loadStore(file, keychain)).hosts[H]?.token).toBe("scout_u_inline");
  });

  it("moves a host's token into the keychain when it is replaced", async () => {
    const { entries, keychain } = fakeKeychain();
    await writeFile(file, JSON.stringify({ hosts: { [H]: { token: "scout_u_inline", userEmail: "ben@example.com" } } }));
    await addHost(H, "scout_u_new", keychain);
    expect(await rawFile()).toEqual({ hosts: { [H]: { userEmail: "ben@example.com" } } });
    expect(entries.get(H)).toBe("scout_u_new");
  });

  it("reads an inline token over a stale keychain entry after a replacement falls back", async () => {
    const reachable = fakeKeychain();
    await addHost(H, "scout_u_old", reachable.keychain);
    const unreachable: Keychain = { ...reachable.keychain, set: async () => false };
    await addHost(H, "scout_u_new", unreachable);
    expect(reachable.entries.get(H)).toBe("scout_u_old");
    expect((await loadStore(file, reachable.keychain)).hosts[H]?.token).toBe("scout_u_new");
  });

  it("deletes a removed host's keychain entry", async () => {
    const { entries, keychain } = fakeKeychain();
    await addHost(H, "scout_u_abc", keychain);
    expect(entries.get(H)).toBe("scout_u_abc");
    await mutateStore((store) => {
      store.hosts = {};
      return { changed: true, result: undefined };
    }, file, keychain);
    expect(entries.has(H)).toBe(false);
    expect(await rawFile()).toEqual({ hosts: {} });
  });

  it("keeps a keychain-held token out of hosts.json when another host signs in", async () => {
    const { keychain } = fakeKeychain();
    await addHost(H, "scout_u_abc", keychain);
    await addHost(O, "scout_u_other", keychain);
    expect(await rawFile()).toEqual({ hosts: {
      [H]: { userEmail: "ben@example.com" },
      [O]: { userEmail: "ben@example.com" },
    } });
  });

  it("keeps a removed host's keychain entry when hosts.json cannot be rewritten", async () => {
    const { entries, keychain } = fakeKeychain();
    await addHost(H, "scout_u_abc", keychain);
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename interrupted"));
    await expect(mutateStore((store) => {
      store.hosts = {};
      return { changed: true, result: undefined };
    }, file, keychain)).rejects.toThrow("rename interrupted");
    expect(entries.get(H)).toBe("scout_u_abc");
    expect((await loadStore(file, keychain)).hosts[H]?.token).toBe("scout_u_abc");
  });

  it("keeps a host whose keychain entry cannot be read while another host signs in", async () => {
    const { entries, locked, keychain } = fakeKeychain();
    await addHost(H, "scout_u_abc", keychain);
    locked.add(H);
    expect((await loadStore(file, keychain)).hosts[H]).toBeUndefined();
    await addHost(O, "scout_u_other", keychain);
    expect(entries.get(H)).toBe("scout_u_abc");
    locked.delete(H);
    expect(Object.keys((await loadStore(file, keychain)).hosts).sort()).toEqual([O, H].sort());
  });
});
