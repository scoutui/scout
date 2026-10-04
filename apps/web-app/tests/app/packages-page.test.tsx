// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "@scoutui/web-shared";
import PackagesPage from "@/app/packages/page";
import type { Role } from "@/lib/access";

const packageRow = (packageName: string) => ({
  packageName,
  consumerCount: 1,
  componentCount: 1,
  totalOccurrences: 1,
  deprecatedCount: 0,
  distinctVersionCount: 1,
  soleVersion: "1.0.0",
});

let packageNames: string[] = [];
const storage = {
  async withReadSnapshot<T>(read: (snapshot: StorageDriver) => Promise<T>) { return read(this as unknown as StorageDriver); },
  skippedScans: () => ({ fallbacks: [], gaps: [] }),
  listPackages: async () => packageNames.map(packageRow),
  listTags: async () => [],
};
vi.mock("@/lib/storage", () => ({ getStorage: () => storage }));
let role: Role = "editor";
vi.mock("@/lib/identity", () => ({
  identify: async () => ({ kind: "person", userId: "u1", email: "ana@example.com", name: null, role, roleSource: "people" }),
}));
let explorerCanEdit: boolean | undefined;
vi.mock("@/components/packages/packages-explorer", () => ({
  PackagesExplorer: ({ canEdit }: { canEdit: boolean }) => {
    explorerCanEdit = canEdit;
    return null;
  },
}));
vi.stubEnv("DATABASE_URL", "");

describe("PackagesPage", () => {
  afterEach(() => {
    role = "editor";
  });

  it.each([
    [["@example/button"], "1 package"],
    [["@example/button", "@example/card"], "2 packages"],
  ])("counts %j as %s", async (names, count) => {
    packageNames = names;
    render(await PackagesPage());
    expect(screen.getByText(count, { exact: true })).toBeInTheDocument();
  });

  it("tells the package list that an Editor can edit and a Viewer can't", async () => {
    packageNames = ["@example/button"];
    explorerCanEdit = undefined;
    render(await PackagesPage());
    expect(explorerCanEdit).toBe(true);
    role = "viewer";
    render(await PackagesPage());
    expect(explorerCanEdit).toBe(false);
  });
});
