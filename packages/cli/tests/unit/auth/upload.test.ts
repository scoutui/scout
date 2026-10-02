import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStore, loadStore, type Store } from "../../../src/auth/store.js";
import { createAuthedUploader } from "../../../src/auth/upload-auth.js";
import { NotSignedInError, ReloginRequiredError, SessionChangedError } from "../../../src/auth/session.js";

let dir: string;
let file: string;
const BASE = "https://h.example";
const OTHER = "https://other.example";
const receipt = { uploadId: "U1", statusUrl: "/api/scans/uploads/U1" };
const ready = { state: "ready", readable: true, scanId: "S1", url: "/repos/repo-a/scans/S1" };

beforeEach(async () => {
  vi.stubEnv("SCOUTUI_TOKEN", "");
  vi.stubEnv("SCOUTUI_HOST", undefined);
  dir = await mkdtemp(join(tmpdir(), "cc-upauth-"));
  file = join(dir, "hosts.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function signedInStore(): Store {
  return {
    default: BASE,
    hosts: {
      [BASE]: { token: "scout_u_user", userEmail: "user@example.com" },
      [OTHER]: { token: "scout_u_other", userEmail: "other@example.com" },
    },
  };
}

describe("createAuthedUploader", () => {
  it("keeps a replacement login when an older upload receives a delayed 401", async () => {
    await saveStore(signedInStore(), file);
    let signalStarted: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      signalStarted();
      await held;
      return Response.json({ error: "unauthorized" }, { status: 401 });
    });
    const up = await createAuthedUploader({ store: { filePath: file } });
    const upload = up.upload("{}");
    await started;
    await saveStore({ default: BASE, hosts: {
      [BASE]: { token: "scout_u_new", userEmail: "new@example.com" },
      [OTHER]: { token: "scout_u_other", userEmail: "other@example.com" },
    } }, file);
    release();
    await expect(upload).rejects.toBeInstanceOf(SessionChangedError);
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_new", userEmail: "new@example.com" });
    expect((await loadStore(file)).hosts[OTHER]).toBeDefined();
  });

  it("reports a changed session and keeps the receipt when an older status request gets 401", async () => {
    await saveStore(signedInStore(), file);
    let signalStarted: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockImplementationOnce(async () => {
        signalStarted();
        await held;
        return Response.json({ error: "unauthorized" }, { status: 401 });
      });
    const up = await createAuthedUploader({ store: { filePath: file } });
    const upload = up.upload("{}");
    await started;
    await saveStore({ default: BASE, hosts: {
      [BASE]: { token: "scout_u_new", userEmail: "new@example.com" },
      [OTHER]: { token: "scout_u_other", userEmail: "other@example.com" },
    } }, file);
    release();
    await expect(upload).rejects.toMatchObject({
      receipt,
      statusUrl: `${BASE}/api/scans/uploads/U1`,
      cause: { message: expect.stringMatching(/session changed.*retry/i) },
    });
    expect((await loadStore(file)).hosts[BASE]).toEqual({ token: "scout_u_new", userEmail: "new@example.com" });
  });

  it("submits and polls with the same session without rewriting the credential file", async () => {
    await saveStore(signedInStore(), file);
    const original = await readFile(file, "utf8");
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const [up] = await Promise.all(Array.from({ length: 8 }, () => createAuthedUploader({ store: { filePath: file } })));
    expect(await up.upload("{}")).toEqual({ status: "inserted", scanId: "S1", url: "/repos/repo-a/scans/S1" });
    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init?.method, new Headers(init?.headers).get("Authorization")])).toEqual([
      [`${BASE}/api/scans`, "POST", "Bearer scout_u_user"],
      [`${BASE}/api/scans/uploads/U1`, "GET", "Bearer scout_u_user"],
    ]);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("clears only the selected user session after one rejected submission", async () => {
    await saveStore(signedInStore(), file);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    const up = await createAuthedUploader({ store: { filePath: file } });
    await expect(up.upload("{}")).rejects.toBeInstanceOf(ReloginRequiredError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await loadStore(file)).hosts).toEqual({ [OTHER]: { token: "scout_u_other", userEmail: "other@example.com" } });
  });

  it("retains an acknowledged receipt after one rejected status request", async () => {
    await saveStore(signedInStore(), file);
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    const up = await createAuthedUploader({ store: { filePath: file } });
    await expect(up.upload("{}")).rejects.toMatchObject({
      receipt, statusUrl: `${BASE}/api/scans/uploads/U1`, cause: expect.any(ReloginRequiredError),
    });
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect((await loadStore(file)).hosts[BASE]).toBeUndefined();
    expect((await loadStore(file)).hosts[OTHER]).toBeDefined();
  });

  it.each(["transport", "500"])("preserves a user session after a %s failure", async (mode) => {
    await saveStore(signedInStore(), file);
    const fetchSpy = vi.spyOn(global, "fetch");
    if (mode === "transport") fetchSpy.mockRejectedValue(new Error("connection reset"));
    else fetchSpy.mockResolvedValue(Response.json({ error: "server_error" }, { status: 500 }));
    const up = await createAuthedUploader({ store: { filePath: file } });
    await expect(up.upload("{}")).rejects.toThrow();
    expect((await loadStore(file)).hosts[BASE]).toBeDefined();
  });

  it("uses a CI token directly without a stored login", async () => {
    vi.stubEnv("SCOUTUI_TOKEN", "ci-secret");
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }))
      .mockResolvedValueOnce(Response.json(ready));
    const up = await createAuthedUploader({ flagHost: BASE, store: { filePath: file } });
    expect((await up.upload("{}")).status).toBe("inserted");
    expect(fetchSpy.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"))).toEqual(["Bearer ci-secret", "Bearer ci-secret"]);
  });

  it.each(["submission", "polling"])("fails a CI 401 during %s after one request per phase", async (phase) => {
    vi.stubEnv("SCOUTUI_TOKEN", "ci-secret");
    const fetchSpy = vi.spyOn(global, "fetch");
    if (phase === "polling") fetchSpy.mockResolvedValueOnce(Response.json(receipt, { status: 202 }));
    fetchSpy.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    const up = await createAuthedUploader({ flagHost: BASE, store: { filePath: file } });
    await expect(up.upload("{}")).rejects.toThrow(
      "Couldn't upload the scan: the dashboard rejected SCOUTUI_TOKEN. Check that it matches the dashboard's upload token.",
    );
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(phase === "polling" ? ["POST", "GET"] : ["POST"]);
  });

  it("requires a stored session without a CI token", async () => {
    await expect(createAuthedUploader({ flagHost: BASE, store: { filePath: file } })).rejects.toBeInstanceOf(NotSignedInError);
  });
});
