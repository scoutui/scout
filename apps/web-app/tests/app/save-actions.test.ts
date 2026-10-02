import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveDashboard } from "@/app/charts/dashboard-actions";
import { saveGovernance } from "@/app/governance/governance-actions";
import { quickTagPackage, saveTag } from "@/app/packages/tag-actions";

const storage = vi.hoisted(() => ({
  listTags: vi.fn(async () => [
    { id: "tag-1", value: "core", category: "library", color: "chart-1", rule: { glob: ["@example/*"], exact: [] } },
  ]),
  upsertTag: vi.fn(async () => ({})),
  listGovernance: vi.fn(async () => []),
  createGovernance: vi.fn(async () => ({ id: "gov-1" })),
  updateGovernance: vi.fn(async () => ({ id: "gov-2" })),
  upsertDashboard: vi.fn(async () => ({ id: "dash-1" })),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/storage", () => ({ getStorage: () => storage }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

// Server actions receive whatever the browser sends, so these payloads bypass
// the declared parameter types on purpose.
const send = <T>(input: unknown) => input as T;

const tag = { value: "core", category: "library", color: "chart-1", rule: { glob: ["@example/*"], exact: [] } };
const governance = {
  grain: "component",
  targetPackage: "@example/old",
  targetExport: "Button",
  disposition: { kind: "retired", reason: "Use the new button" },
} as const;
const dashboard = {
  name: "Local usage",
  description: null,
  config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" },
} as const;

beforeEach(() => {
  for (const write of Object.values(storage)) write.mockClear();
});

describe("save actions", () => {
  it("store well-formed input without fields the schema doesn't know", async () => {
    await expect(saveTag(send({ ...tag, extra: "dropped" }))).resolves.toEqual({ ok: true });
    expect(storage.upsertTag).toHaveBeenCalledWith(tag, "user-1");

    await expect(saveGovernance(send({ ...governance, extra: "dropped" }))).resolves.toEqual({ ok: true, id: "gov-1" });
    expect(storage.createGovernance).toHaveBeenCalledWith(governance, "user-1");

    await expect(saveGovernance(send({ id: "gov-2", ...governance }))).resolves.toEqual({ ok: true, id: "gov-2" });
    expect(storage.updateGovernance).toHaveBeenCalledWith("gov-2", { id: "gov-2", ...governance }, "user-1");

    await saveDashboard(send({ ...dashboard, extra: "dropped" }));
    expect(storage.upsertDashboard).toHaveBeenCalledWith({ ...dashboard, createdByUserId: "user-1" });
  });

  it("rejects a malformed tag without storing it", async () => {
    await expect(saveTag(send({ ...tag, rule: { glob: "@example/*" } }))).resolves.toEqual({
      ok: false,
      error: "Couldn't save the tag. Reload the page and try again.",
    });
    expect(storage.upsertTag).not.toHaveBeenCalled();
  });

  it("quick-tags a package onto an existing tag", async () => {
    await expect(quickTagPackage("tag-1", "@example/button", true)).resolves.toEqual({ ok: true });
    expect(storage.upsertTag).toHaveBeenCalledWith({ id: "tag-1", ...tag, rule: { ...tag.rule, exact: ["@example/button"] } }, "user-1");
  });

  it.each([
    ["a package name that isn't text", { name: "@example/button" }],
    ["an empty package name", ""],
    ["a blank package name", "  "],
  ])("rejects quick-tagging %s without storing it", async (_case, packageName) => {
    await expect(quickTagPackage("tag-1", send(packageName), true)).resolves.toEqual({
      ok: false,
      error: "Couldn't update the tag. Reload the page and try again.",
    });
    expect(storage.upsertTag).not.toHaveBeenCalled();
  });

  it("rejects a malformed governance record without storing it", async () => {
    await expect(saveGovernance(send({ ...governance, disposition: { kind: "deleted" } }))).resolves.toEqual({
      ok: false,
      error: "Couldn't save the record. Reload the page and try again.",
    });
    expect(storage.createGovernance).not.toHaveBeenCalled();
    expect(storage.updateGovernance).not.toHaveBeenCalled();
  });

  it("refuses a package record that names a component when the package already has a record", async () => {
    storage.listGovernance.mockResolvedValueOnce(
      send([
        {
          id: "pkg-1",
          grain: "package",
          targetPackage: "@example/old",
          targetExport: null,
          disposition: { kind: "retired", reason: "Use @example/new" },
          createdAt: "t",
          updatedAt: "t",
        },
      ]),
    );
    await expect(saveGovernance(send({ ...governance, grain: "package" }))).resolves.toEqual({
      ok: false,
      error: "Couldn't save the record. Reload the page and try again.",
      conflict: { kind: "invalid_field", field: "targetExport" },
    });
    expect(storage.createGovernance).not.toHaveBeenCalled();
    expect(storage.updateGovernance).not.toHaveBeenCalled();
  });

  it("rejects a malformed chart without storing it", async () => {
    await expect(saveDashboard(send({ ...dashboard, config: { ...dashboard.config, cohorts: [] } }))).resolves.toEqual({
      ok: false,
      error: "Couldn't save the chart. Reload the page and try again.",
    });
    expect(storage.upsertDashboard).not.toHaveBeenCalled();
  });
});
