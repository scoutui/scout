import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore, type Store } from "../../../src/auth/store.js";
import { runAuth } from "../../../src/commands/auth.js";
import * as client from "../../../src/auth/client.js";
import * as browser from "../../../src/auth/browser.js";
import type { PromptAdapter } from "../../../src/prompts/adapter.js";

let dir: string;
let file: string;
const BASE = "https://h.example";
const CANCEL = Symbol("cancel");

function stubAdapter(over: Partial<PromptAdapter>): PromptAdapter {
  return {
    intro: () => {},
    outro: () => {},
    text: async () => BASE,
    confirm: async () => true,
    select: async (o) => o.options[0]!.value,
    multiselect: async () => [],
    isCancel: (v): v is symbol => v === CANCEL,
    ...over,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cc-authi-"));
  file = join(dir, "hosts.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const deviceCode = {
  deviceCode: "dc",
  userCode: "ABCD-EFGH",
  verificationUri: `${BASE}/login/device`,
  verificationUriComplete: `${BASE}/login/device?code=ABCD-EFGH`,
  expiresIn: 600,
  interval: 5,
  warning: null,
};

describe("interactive auth login", () => {
  it("prompts for the host when none is supplied and stores a session", async () => {
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockResolvedValue({
      kind: "session",
      session: { token: `scout_u_${"a".repeat(43)}`, email: "b@e.co", role: null },
    });
    const prompts = stubAdapter({ text: async () => BASE });
    const code = await runAuth(["login"], {
      env: {},
      store: { filePath: file },
      interactive: true,
      prompts,
      sleep: async () => {},
      now: () => 0,
    });
    expect(code).toBe(0);
    expect((await loadStore(file)).hosts[BASE]).toBeDefined();
  });

  it("signs in to the dashboard the config names without asking for an address", async () => {
    await writeFile(join(dir, "scout.config.json"), JSON.stringify({ include: ["src/**"], host: BASE }));
    vi.spyOn(client, "requestDeviceCode").mockResolvedValue(deviceCode);
    vi.spyOn(browser, "openBrowser").mockReturnValue(true);
    vi.spyOn(client, "pollToken").mockResolvedValue({ kind: "session", session: { token: `scout_u_${"a".repeat(43)}`, email: "b@e.co", role: null } });
    const asked: string[] = [];
    const prompts = stubAdapter({
      text: async (o) => {
        asked.push(o.message);
        return CANCEL;
      },
    });
    const code = await runAuth(["login"], { env: {}, cwd: dir, store: { filePath: file }, interactive: true, prompts, sleep: async () => {}, now: () => 0 });
    expect(code).toBe(0);
    expect(asked).toEqual([]);
    expect((await loadStore(file)).hosts[BASE]).toBeDefined();
  });

  it("returns 130 when the host prompt is cancelled", async () => {
    const asked: string[] = [];
    const prompts = stubAdapter({
      text: async (o) => {
        asked.push(o.message);
        return CANCEL;
      },
    });
    const code = await runAuth(["login"], { env: {}, cwd: dir, store: { filePath: file }, interactive: true, prompts });
    expect(code).toBe(130);
    expect(asked).toEqual(["Dashboard address"]);
  });
});

describe("interactive auth logout", () => {
  it("selects which host to log out of when several are stored", async () => {
    const store: Store = {
      hosts: {
        [BASE]: { token: "scout_u_abc", userEmail: "b@e.co" },
        "https://other.example": { token: "scout_u_other", userEmail: "c@e.co" },
      },
    };
    await saveStore(store, file);
    vi.spyOn(client, "revokeSession").mockResolvedValue();
    const prompts = stubAdapter({
      select: async (o) => {
        expect(o.message).toBe("Which dashboard?");
        const base = o.options.find((option) => String(option.value) === BASE);
        if (!base) throw new Error(`logout did not offer ${BASE}`);
        return base.value;
      },
    });
    const code = await runAuth(["logout"], { env: {}, store: { filePath: file }, interactive: true, prompts });
    expect(code).toBe(0);
    expect((await loadStore(file)).hosts[BASE]).toBeUndefined();
  });
});
