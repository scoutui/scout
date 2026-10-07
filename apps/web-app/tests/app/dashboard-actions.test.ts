import { describe, expect, it, vi } from "vitest";
import type { ComponentRow, StorageDriver } from "@scoutui/web-shared";
import { pickableForRepo, previewDashboard } from "@/app/charts/dashboard-actions";
import type { identify, requireEditor } from "@/lib/identity";

const identity = vi.hoisted(() => ({
  identify: vi.fn<typeof identify>(async () => ({ kind: "person", userId: "user-1", email: "ana@example.com", name: null, role: "editor", roleSource: "people" })),
  requireEditor: vi.fn<typeof requireEditor>(async () => ({ ok: true, userId: "user-1" })),
}));
vi.mock("@/lib/identity", () => identity);
vi.mock("@/lib/storage", () => ({ getStorage: () => storage }));
vi.stubEnv("DATABASE_URL", "");

const row: ComponentRow = {
  componentId: "77b809260ecd27fe", kind: "react-component", scope: "external", packageName: "@x/lib", displayName: "Address",
  disambiguator: null, version: "1.2.3", occurrenceCount: 3, fileCount: 2, deprecated: true, tags: [],
};
const storage = {
  async withReadSnapshot<T>(read: (snapshot: StorageDriver) => Promise<T>) { return read(this as unknown as StorageDriver); },
  skippedScans: () => ({ fallbacks: [], gaps: [] }),
  listComponentsForRepo: async (repoId: string) => repoId === "known" ? [row] : [],
  listPackages: async (repoId?: string) => repoId === "known"
    ? ["@x/lib", "@x/aggregate"].map((packageName) => ({
        packageName,
        consumerCount: 1,
        componentCount: 1,
        totalOccurrences: 1,
        deprecatedCount: 0,
        distinctVersionCount: 1,
        soleVersion: "1.0.0",
      }))
    : [],
};

describe("pickableForRepo", () => {
  it("sorts the repo-scoped package list for the chart picker", async () => {
    const result = await pickableForRepo("known");
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("Expected ready picker");
    expect(result.value.packages).toEqual(["@x/aggregate", "@x/lib"]);
    expect(result.value.components).toEqual([{ componentId: "77b809260ecd27fe", displayName: "Address", packageName: "@x/lib", disambiguator: null, deprecated: true, occurrences: 3, local: false }]);
  });

  it("returns no options when the repo has no scan", async () => {
    expect(await pickableForRepo("missing")).toEqual({ state: "ready", value: { components: [], packages: [] }, fallbacks: [], gaps: [] });
  });
});

describe("chart builder reads", () => {
  it("refuse a caller who isn't signed in", async () => {
    identity.identify.mockResolvedValue(null);
    identity.requireEditor.mockResolvedValue({ ok: false, error: "not_authenticated" });
    try {
      await expect(pickableForRepo("known")).rejects.toThrow("not_authenticated");
      await expect(previewDashboard({ scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" }))
        .rejects.toThrow("not_authenticated");
    } finally {
      identity.identify.mockReset();
      identity.requireEditor.mockReset();
    }
  });
});
