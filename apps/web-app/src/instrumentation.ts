/**
 * Runs once per server start, before the first request is answered. A pod
 * that cannot finish this must restart rather than stay up failing every
 * request, so a startup error ends the process.
 */
export async function register(): Promise<void> {
  // The import must sit inside this block: the edge bundle is built from this
  // file too, and only a block guarded by a compile-time constant is dropped
  // before the database driver's Node-only dependencies get resolved.
  // biome-ignore lint/complexity/useLiteralKeys: env access
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    try {
      // Covered by the catch: the startup module pulls in the database driver at
      // module scope, so a dependency that fails to load rejects this import
      // rather than the call, and that failure has to reach the exit too.
      const { runStartup } = await import("./lib/startup");
      await runStartup(process.env);
    } catch (err) {
      console.error("[startup] failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
