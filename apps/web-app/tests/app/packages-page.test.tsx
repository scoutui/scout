// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "@scoutui/web-shared";
import PackagesPage from "@/app/packages/page";

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
vi.mock("@/components/packages/packages-explorer", () => ({ PackagesExplorer: () => null }));
vi.stubEnv("DATABASE_URL", "");

describe("PackagesPage", () => {
  it.each([
    [["@example/button"], "1 package"],
    [["@example/button", "@example/card"], "2 packages"],
  ])("counts %j as %s", async (names, count) => {
    packageNames = names;
    render(await PackagesPage());
    expect(screen.getByText(count, { exact: true })).toBeInTheDocument();
  });
});
