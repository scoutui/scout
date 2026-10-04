import { describe, it, expect, vi, afterAll } from "vitest";
import path from "node:path";

vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: vi.fn() }));

import { migrateOnStartEnabled, resolveMigrationsDir, runStartup } from "@/lib/startup";

describe("migrateOnStartEnabled", () => {
  it("is on when unset", () => {
    expect(migrateOnStartEnabled({})).toBe(true);
  });
  it("is on for any value other than the string false", () => {
    expect(migrateOnStartEnabled({ MIGRATE_ON_START: "true" })).toBe(true);
    expect(migrateOnStartEnabled({ MIGRATE_ON_START: "1" })).toBe(true);
    expect(migrateOnStartEnabled({ MIGRATE_ON_START: "" })).toBe(true);
  });
  it("is off only for the string false, any case", () => {
    expect(migrateOnStartEnabled({ MIGRATE_ON_START: "false" })).toBe(false);
    expect(migrateOnStartEnabled({ MIGRATE_ON_START: "FALSE" })).toBe(false);
  });
});

describe("resolveMigrationsDir", () => {
  it("defaults to drizzle/migrations under the working directory", () => {
    expect(resolveMigrationsDir({})).toBe(path.resolve(process.cwd(), "drizzle/migrations"));
  });
  it("honours SCOUTUI_MIGRATIONS_DIR", () => {
    expect(resolveMigrationsDir({ SCOUTUI_MIGRATIONS_DIR: "/srv/m" })).toBe("/srv/m");
  });
});

describe("runStartup", () => {
  // Startup narrates what it did on stdout; these tests own that channel so the
  // run's report carries test output only.
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  afterAll(() => {
    log.mockRestore();
  });

  it("does nothing when migrations are off", async () => {
    await expect(runStartup({ MIGRATE_ON_START: "false", SCOUTUI_ADMINS: "ana@example.com" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("off"));
  });
  it("rejects an invalid scan upload setting before anything else", async () => {
    await expect(runStartup({ MIGRATE_ON_START: "false", SCOUTUI_MAX_UPLOAD_BYTES: "42MiB" })).rejects.toThrow("SCOUTUI_MAX_UPLOAD_BYTES");
    await expect(runStartup({ SCOUTUI_UPLOAD_RECEIVE_SLOTS: "0" })).rejects.toThrow("SCOUTUI_UPLOAD_RECEIVE_SLOTS");
  });
  it("rejects a trusted proxy count that isn't a positive whole number", async () => {
    await expect(runStartup({ MIGRATE_ON_START: "false", SCOUTUI_TRUSTED_PROXY_HOPS: "0" })).rejects.toThrow("SCOUTUI_TRUSTED_PROXY_HOPS");
  });
  it("fails when on and DATABASE_URL is missing", async () => {
    await expect(runStartup({ SCOUTUI_ADMINS: "ana@example.com" })).rejects.toThrow(/DATABASE_URL/);
  });
  it.each([
    { case: "fails with neither admin setting and the dev sign-in off", env: {}, error: "Set SCOUTUI_ADMINS to your admins' email addresses, or SCOUTUI_ADMIN_GROUP to a group in your sign-in provider." },
    { case: "starts with only SCOUTUI_ADMIN_GROUP", env: { SCOUTUI_ADMIN_GROUP: "scout-admins" }, error: null },
    { case: "starts with neither admin setting when the dev sign-in is on", env: { NODE_ENV: "development", DEV_AUTH_PASSWORD: "hunter2" }, error: null },
  ])("$case", async ({ env, error }) => {
    const started = runStartup({ MIGRATE_ON_START: "false", ...env });
    if (error === null) await expect(started).resolves.toBeUndefined();
    else await expect(started).rejects.toThrow(error);
  });
});
