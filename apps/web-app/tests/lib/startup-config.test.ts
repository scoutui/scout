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
    { case: "fails with neither admin setting in production, even with a dev password set", env: { NODE_ENV: "production", DEV_AUTH_PASSWORD: "x" }, error: "Set SCOUTUI_ADMINS to your admins' email addresses, or SCOUTUI_ADMIN_GROUP to a group in your sign-in provider." },
    { case: "fails with only SCOUTUI_EDITOR_GROUP, which isn't an admin setting", env: { SCOUTUI_EDITOR_GROUP: "scout-editors" }, error: "Set SCOUTUI_ADMINS to your admins' email addresses, or SCOUTUI_ADMIN_GROUP to a group in your sign-in provider." },
    { case: "fails with roles from groups only and no role group", env: { SCOUTUI_ADMINS: "ana@example.com", SCOUTUI_ROLES_FROM_GROUPS_ONLY: "true" }, error: "SCOUTUI_ROLES_FROM_GROUPS_ONLY is on, so set SCOUTUI_ADMIN_GROUP or SCOUTUI_EDITOR_GROUP to a group in your sign-in provider." },
    { case: "starts with roles from groups only and SCOUTUI_EDITOR_GROUP", env: { SCOUTUI_ADMINS: "ana@example.com", SCOUTUI_EDITOR_GROUP: "scout-editors", SCOUTUI_ROLES_FROM_GROUPS_ONLY: "true" }, error: null },
    { case: "starts with roles from groups only and SCOUTUI_ADMIN_GROUP", env: { SCOUTUI_ADMIN_GROUP: "scout-admins", SCOUTUI_ROLES_FROM_GROUPS_ONLY: "true" }, error: null },
    { case: "fails with a roles-from-groups-only value that isn't true or false", env: { SCOUTUI_ADMIN_GROUP: "scout-admins", SCOUTUI_ROLES_FROM_GROUPS_ONLY: "TRUE" }, error: 'Set SCOUTUI_ROLES_FROM_GROUPS_ONLY to true or false, not "TRUE".' },
    { case: "starts with roles from groups only set to false", env: { SCOUTUI_ADMINS: "ana@example.com", SCOUTUI_ROLES_FROM_GROUPS_ONLY: "false" }, error: null },
  ])("$case", async ({ env, error }) => {
    const started = runStartup({ MIGRATE_ON_START: "false", ...env });
    if (error === null) await expect(started).resolves.toBeUndefined();
    else await expect(started).rejects.toThrow(error);
  });
});
