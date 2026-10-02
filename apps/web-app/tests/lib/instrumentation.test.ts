import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

const runStartup = vi.fn<(env: Record<string, string | undefined>) => Promise<void>>();
const startupModule = { loads: true };

async function load() {
  vi.resetModules();
  return (await import("@/instrumentation")).register;
}

describe("register", () => {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const originalRuntime = process.env["NEXT_RUNTIME"];
  let exit: MockInstance;
  let error: MockInstance;

  beforeEach(() => {
    runStartup.mockReset();
    startupModule.loads = true;
    // The only mock of this module: when two are pending, vitest registers them
    // in whichever order their paths resolve, so the later one can lose.
    vi.doMock("@/lib/startup", () => {
      if (!startupModule.loads) throw new Error("driver not found");
      return { runStartup };
    });
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    exit.mockRestore();
    error.mockRestore();
    // Assigning `undefined` would leave the string "undefined" in the
    // environment, so the unset branch has to delete the key.
    if (originalRuntime === undefined) Reflect.deleteProperty(process.env, "NEXT_RUNTIME");
    // biome-ignore lint/complexity/useLiteralKeys: env access
    else process.env["NEXT_RUNTIME"] = originalRuntime;
  });

  it("does nothing outside the Node runtime", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    process.env["NEXT_RUNTIME"] = "edge";
    const register = await load();
    await register();
    expect(runStartup).not.toHaveBeenCalled();
  });

  it("runs startup in the Node runtime", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    process.env["NEXT_RUNTIME"] = "nodejs";
    runStartup.mockResolvedValue(undefined);
    const register = await load();
    await register();
    expect(runStartup).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits the process when startup fails", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    process.env["NEXT_RUNTIME"] = "nodejs";
    runStartup.mockRejectedValue(new Error("boom"));
    const register = await load();
    await register();
    expect(error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits the process when the startup module fails to load", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    process.env["NEXT_RUNTIME"] = "nodejs";
    // The startup module imports the database driver at module scope, so a
    // dependency that cannot load rejects the import rather than the call.
    startupModule.loads = false;
    const register = await load();
    await register();
    expect(runStartup).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[startup] failed:", expect.stringMatching(/\S/));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
