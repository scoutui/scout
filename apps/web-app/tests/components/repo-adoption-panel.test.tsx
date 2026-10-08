// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
        repoId="r1"
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
    render(<RepoAdoptionPanel repoId="r1" tracking={[]} notice={null} canEdit={false} />);

    expect(screen.getByText("No migrations or retirements tracked yet.")).toBeDefined();
    expect(screen.queryByText(/Mark a component as replaced/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Governance" })).toBeNull();
  });

  it("shows the Governance empty state when tracking is absent without a preparation notice", () => {
    render(<RepoAdoptionPanel repoId="r1" tracking={null} notice={null} canEdit />);

    expect(screen.getByText("No migrations or retirements tracked yet.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Open Governance" }).getAttribute("href")).toBe("/governance");
  });

  it("lists the repo's migrations in progress and complete, each opening its chart for this repo", () => {
    const done = { ...record("g-done", "OldThing"), disposition: { kind: "superseded" as const, by: { packageName: "@x/other-ds" } } };
    const tracking = deriveGovernanceTracking([record("g-live", "Button"), done], digests, { kind: "repo", repoId: "r1" }, asOf);
    render(<RepoAdoptionPanel repoId="r1" tracking={tracking} notice={null} canEdit />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Migrations and retirements in this repo");
    expect(screen.getByRole("button", { name: "Complete 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "legacy-ds" }));
    expect(screen.getByRole("link", { name: /Button/ })).toHaveAttribute("href", "/charts/migration%3Ag-live?repo=r1");
  });

  it.each([
    { replaced: ["Badge"], message: "No scan of this repo has found a use of Badge · legacy-ds, so there's nothing to migrate." },
    { replaced: ["Badge", "Chip"], message: "No scan of this repo has found a use of a replaced component, so there's nothing to migrate." },
  ])("says there's nothing to migrate when no scan of the repo uses $replaced", ({ replaced, message }) => {
    const unused: DigestScan = {
      meta: { scanId: "s3", committedAt: "2026-01-03T00:00:00Z", arrivedAt: "2026-01-03T00:00:00Z", repo: { id: "r2" } },
      components: replaced.map((name) => component(packageExport("legacy-ds", name), { stats: { occurrenceCount: 0, fileCount: 0 }, usage: "direct" })),
    };
    const records = replaced.map((name) => ({ ...record(`g-${name}`, name), disposition: { kind: "superseded" as const, by: { packageName: `@x/${name}` } } }));
    const tracking = deriveGovernanceTracking(records, [unused], { kind: "repo", repoId: "r2" }, asOf);
    expect(tracking).toHaveLength(replaced.length);
    render(<RepoAdoptionPanel repoId="r2" tracking={tracking} notice={null} canEdit />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("renders the preparing state in place of the tracking sections when no stored tracking exists", () => {
    render(<RepoAdoptionPanel repoId="r1" tracking={null} notice={{ state: "preparing", scans: [], retryable: true }} canEdit />);
    expect(screen.getByRole("status").textContent).toContain("This loads on its own when it's ready.");
    expect(screen.queryByText(/Migrations and retirements/)).toBeNull();
  });

  it("renders the failed state above the stored tracking sections", () => {
    const governance = [record("g-live", "Button")];
    const tracking = deriveGovernanceTracking(governance, digests, { kind: "repo", repoId: "r1" }, asOf);
    render(<RepoAdoptionPanel repoId="r1" tracking={tracking} notice={{ state: "failed", scans: [{ scanId: "s2", repoId: "r1", commit: "0123456789" }], retryable: false }} canEdit />);
    expect(screen.getByText("Numbers may be out of date")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Migrations and retirements in this repo");
  });
});
