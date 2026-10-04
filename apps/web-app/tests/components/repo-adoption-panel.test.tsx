// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { deriveGovernanceTracking, type DigestScan, type GovernanceRecord } from "@scoutui/web-shared";
import { component, packageExport } from "../../../../packages/web-shared/tests/helpers/builders.js";

// The sparkline would pull recharts into jsdom, and no assertion needs it.
vi.mock("@/components/dashboards/dashboard-sparkline", () => ({
  DashboardSparkline: () => null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const live = (occurrenceCount: number) =>
  component(packageExport("legacy-ds", "Button"), { stats: { occurrenceCount, fileCount: 1 }, usage: "direct" });

const asOf = "2026-02-01T00:00:00Z";
const digests: DigestScan[] = [
  {
    meta: { scanId: "s1", committedAt: "2026-01-01T00:00:00Z", arrivedAt: "2026-01-01T00:00:00Z", repo: { id: "r1" } },
    components: [
      // Still in use at the latest scan -> its migration stays active.
      live(10),
      // Present here, gone by s2 -> its migration reads complete.
      component(packageExport("legacy-ds", "OldThing"), { stats: { occurrenceCount: 5, fileCount: 1 }, usage: "direct" }),
    ],
  },
  {
    meta: { scanId: "s2", committedAt: "2026-01-02T00:00:00Z", arrivedAt: "2026-01-02T00:00:00Z", repo: { id: "r1" } },
    components: [live(4)],
  },
];

const record = (id: string, targetExport: string): GovernanceRecord => ({
  id,
  grain: "component",
  targetPackage: "legacy-ds",
  targetExport,
  disposition: { kind: "superseded", by: { packageName: "@x/new-ds" } },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const { RepoAdoptionPanel } = await import("@/components/repos/repo-adoption-panel");

describe("RepoAdoptionPanel governance tracking", () => {
  it("shows the Governance empty state when no tracking applies to this repo", () => {
    render(
      <RepoAdoptionPanel
        tracking={[]}
        notice={null}
        canEdit
      />,
    );

    expect(screen.getByText("No migrations or retirements tracked yet.")).toBeDefined();
    expect(screen.getByText("Mark a component as replaced or retired in Governance to track its progress here.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Open Governance" }).getAttribute("href")).toBe("/governance");
    expect(screen.queryByText("Library mix, latest scan")).toBeNull();
    expect(screen.queryByText("Library usage over time")).toBeNull();
    expect(screen.queryByText("No library tags configured.")).toBeNull();
  });

  it("shows someone who can't edit only the empty state's title, with no Open Governance link", () => {
    render(<RepoAdoptionPanel tracking={[]} notice={null} canEdit={false} />);

    expect(screen.getByText("No migrations or retirements tracked yet.")).toBeDefined();
    expect(screen.queryByText(/Mark a component as replaced/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Governance" })).toBeNull();
  });

  it("shows the Governance empty state when tracking is absent without a preparation notice", () => {
    render(<RepoAdoptionPanel tracking={null} notice={null} canEdit />);

    expect(screen.getByText("No migrations or retirements tracked yet.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Open Governance" }).getAttribute("href")).toBe("/governance");
  });

  it("keeps completed migrations in the collapsed ledger instead of dropping them", async () => {
    // A finished migration still shows here, as it does on /charts.
    const done = { ...record("g-done", "OldThing"), disposition: { kind: "superseded" as const, by: { packageName: "@x/other-ds" } } };
    const tracking = deriveGovernanceTracking([record("g-live", "Button"), done], digests, { kind: "repo", repoId: "r1" }, asOf);
    render(<RepoAdoptionPanel tracking={tracking} notice={null} canEdit />);

    expect(screen.getByText("Migrations in this repo · 1 in progress · 1 complete · change over the last 30 days")).toBeDefined();
    expect(screen.getByText("Show 1 complete")).toBeDefined();
  });

  it("renders the preparing state in place of the tracking sections when no stored tracking exists", () => {
    render(<RepoAdoptionPanel tracking={null} notice={{ state: "preparing", scans: [], retryable: true }} canEdit />);
    expect(screen.getByRole("status").textContent).toContain("This loads on its own when it's ready.");
    expect(screen.queryByText(/Migrations in this repo/)).toBeNull();
  });

  it("renders the failed state above the stored tracking sections", () => {
    const governance = [record("g-live", "Button")];
    const tracking = deriveGovernanceTracking(governance, digests, { kind: "repo", repoId: "r1" }, asOf);
    render(<RepoAdoptionPanel tracking={tracking} notice={{ state: "failed", scans: [{ scanId: "s2", repoId: "r1", commit: "0123456789" }], retryable: false }} canEdit />);
    expect(screen.getByText("Numbers may be out of date")).toBeDefined();
    expect(screen.getByText("Migrations in this repo · 1 in progress · change over the last 30 days")).toBeDefined();
  });
});
