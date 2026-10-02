// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import { GovernanceManager } from "@/components/governance/governance-manager";

vi.mock("@/app/governance/governance-actions", () => ({
  saveGovernance: vi.fn(async () => ({ ok: true })),
  deleteGovernance: vi.fn(async () => ({ ok: true })),
}));

const records: GovernanceRecord[] = [
  {
    id: "r1",
    grain: "component",
    targetPackage: "@acme/old",
    targetExport: "Button",
    disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "r2",
    grain: "component",
    targetPackage: "@acme/old",
    targetExport: "Chip",
    disposition: { kind: "retired", reason: "No replacement" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const sources = [
  { packageName: "@acme/old", exportName: "Button" },
  { packageName: "@acme/new", exportName: "Button" },
];

describe("GovernanceManager", () => {
  it("groups records sharing a package under one package heading, each row carrying its own disposition", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={0} />);
    expect(screen.getByRole("heading", { level: 2, name: "@acme/old" })).toBeInTheDocument();
    expect(screen.getByText("Button")).toBeInTheDocument();
    expect(screen.getByText("Chip")).toBeInTheDocument();
    expect(screen.getByText("superseded")).toBeInTheDocument();
    expect(screen.getByText(/No replacement/)).toBeInTheDocument();
  });

  it("reports every invalid field inline as an alert on submit", async () => {
    // Empty registry: the form is already open (first-run), no click needed.
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((a) => a.textContent).join(" | ");
    expect(text).toMatch(/choose a package or component/i);
    expect(text).toMatch(/choose what supersedes it/i);
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    expect(saveGovernance).not.toHaveBeenCalled();
  });

  it("exposes disposition as a radiogroup whose choice swaps the dependent field", async () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} />);
    const group = screen.getByRole("radiogroup", { name: /disposition/i });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeInTheDocument();
    expect(radios).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    expect(await screen.findByLabelText(/reason/i)).toBeInTheDocument();
  });

  it("names the source picker with its current selection state", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} />);
    expect(screen.getByRole("button", { name: /source: none selected/i })).toBeInTheDocument();
  });

  it("opens the form via Add record for a non-empty registry", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={0} />);
    expect(screen.queryByRole("heading", { level: 2, name: "New lifecycle record" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New lifecycle record" })).toBeInTheDocument();
  });

  it("opens the form automatically on an empty registry, and Cancel reveals the teaching copy which Add record can reopen from", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} />);
    expect(screen.getByRole("heading", { level: 2, name: "New lifecycle record" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { level: 2, name: "New lifecycle record" })).not.toBeInTheDocument();
    expect(screen.getByText("No lifecycle records yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New lifecycle record" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Registry rendering
  // -------------------------------------------------------------------------

  it("floats an unseen record above package groups, with full standalone identity and no tracking link", () => {
    const unseen: GovernanceRecord = {
      id: "u1",
      grain: "component",
      targetPackage: "@ghost/ui",
      targetExport: "Ghost",
      disposition: { kind: "retired", reason: "gone" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const grouped: GovernanceRecord[] = [
      {
        id: "g1",
        grain: "component",
        targetPackage: "@acme/multi",
        targetExport: "One",
        disposition: { kind: "retired", reason: "a" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "g2",
        grain: "component",
        targetPackage: "@acme/multi",
        targetExport: "Two",
        disposition: { kind: "retired", reason: "b" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const stats: Record<string, RecordStat> = {
      u1: { status: "unseen", repos: 0, trackingId: null, successorDeprecated: false },
      g1: { status: "active", repos: 1, trackingId: "retirement:g1", successorDeprecated: false },
      g2: { status: "active", repos: 1, trackingId: "retirement:g2", successorDeprecated: false },
    };
    render(<GovernanceManager records={[unseen, ...grouped]} sources={sources} stats={stats} repoCount={1} />);

    const region = screen.getByRole("region", { name: "Records that never matched a scan" });
    expect(within(region).getByText("@ghost/ui / Ghost")).toBeInTheDocument();
    expect(within(region).queryByRole("link")).not.toBeInTheDocument();

    const heading = screen.getByRole("heading", { level: 2, name: "@acme/multi" });
    // The exceptions section must precede the package groups in document order.
    expect(region.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders a one-record package as a flat row with full identity and no heading, vs a two-record package under one shared heading with export-only rows", () => {
    const oneAndTwo: GovernanceRecord[] = [
      {
        id: "solo",
        grain: "component",
        targetPackage: "@acme/solo",
        targetExport: "Solo",
        disposition: { kind: "retired", reason: "x" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "dup1",
        grain: "component",
        targetPackage: "@acme/dup",
        targetExport: "One",
        disposition: { kind: "retired", reason: "y" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "dup2",
        grain: "component",
        targetPackage: "@acme/dup",
        targetExport: "Two",
        disposition: { kind: "retired", reason: "z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    render(<GovernanceManager records={oneAndTwo} sources={sources} stats={{}} repoCount={0} />);

    // Single-record package: full identity, no heading earned.
    expect(screen.getByText("@acme/solo / Solo")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "@acme/solo" })).not.toBeInTheDocument();

    // Two-record package: one heading states the package once; rows carry only the export.
    expect(screen.getByRole("heading", { level: 2, name: "@acme/dup" })).toBeInTheDocument();
    expect(screen.getAllByText("@acme/dup", { exact: true })).toHaveLength(1);
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.queryByText("@acme/dup / One")).not.toBeInTheDocument();
    expect(screen.queryByText("@acme/dup / Two")).not.toBeInTheDocument();
  });

  it("reads 'active in N repos', with '1 repo' singular, when repoCount > 1", () => {
    const active: GovernanceRecord[] = [
      {
        id: "many",
        grain: "component",
        targetPackage: "@acme/many",
        targetExport: "Many",
        disposition: { kind: "retired", reason: "a" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "one",
        grain: "component",
        targetPackage: "@acme/one",
        targetExport: "One",
        disposition: { kind: "retired", reason: "b" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const stats: Record<string, RecordStat> = {
      many: { status: "active", repos: 5, trackingId: "retirement:many", successorDeprecated: false },
      one: { status: "active", repos: 1, trackingId: "retirement:one", successorDeprecated: false },
    };
    render(<GovernanceManager records={active} sources={sources} stats={stats} repoCount={3} />);
    expect(screen.getByRole("link", { name: "active in 5 repos" })).toHaveAttribute(
      "href",
      "/charts/retirement%3Amany",
    );
    expect(screen.getByRole("link", { name: "active in 1 repo" })).toHaveAttribute(
      "href",
      "/charts/retirement%3Aone",
    );
  });

  it("collapses coverage copy to bare 'active' when repoCount === 1", () => {
    const solo: GovernanceRecord[] = [
      {
        id: "solo2",
        grain: "component",
        targetPackage: "@acme/solo2",
        targetExport: "Solo",
        disposition: { kind: "retired", reason: "a" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const stats: Record<string, RecordStat> = {
      solo2: { status: "active", repos: 1, trackingId: "retirement:solo2", successorDeprecated: false },
    };
    render(<GovernanceManager records={solo} sources={sources} stats={stats} repoCount={1} />);
    expect(screen.getByRole("link", { name: "active" })).toHaveAttribute("href", "/charts/retirement%3Asolo2");
  });

  it("reads 'complete' with no repo count for a complete record, regardless of repoCount", () => {
    const done: GovernanceRecord[] = [
      {
        id: "done",
        grain: "component",
        targetPackage: "@acme/done",
        targetExport: "Done",
        disposition: { kind: "retired", reason: "a" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const stats: Record<string, RecordStat> = {
      done: { status: "complete", repos: 4, trackingId: "retirement:done", successorDeprecated: false },
    };
    render(<GovernanceManager records={done} sources={sources} stats={stats} repoCount={4} />);
    expect(screen.getByRole("link", { name: "complete" })).toHaveAttribute("href", "/charts/retirement%3Adone");
  });

  it("sorts a complete record below active ones within its package group", () => {
    const multi: GovernanceRecord[] = [
      {
        id: "zeta",
        grain: "component",
        targetPackage: "@acme/multi2",
        targetExport: "Zeta",
        disposition: { kind: "retired", reason: "x" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "alpha",
        grain: "component",
        targetPackage: "@acme/multi2",
        targetExport: "Alpha",
        disposition: { kind: "retired", reason: "y" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const stats: Record<string, RecordStat> = {
      // Alphabetically Alpha < Zeta, but status ranks first: the complete
      // record (Alpha) renders after the active one (Zeta).
      zeta: { status: "active", repos: 1, trackingId: "retirement:zeta", successorDeprecated: false },
      alpha: { status: "complete", repos: 0, trackingId: "retirement:alpha", successorDeprecated: false },
    };
    render(<GovernanceManager records={multi} sources={sources} stats={stats} repoCount={1} />);
    const exportNames = screen.getAllByText(/^(Zeta|Alpha)$/).map((el) => el.textContent);
    expect(exportNames).toEqual(["Zeta", "Alpha"]);
  });

  it("renders the jump link to the existing record on a target_governed conflict", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /source: none selected/i }));
    const option = await screen.findByRole("option", { name: /^@acme\/old/ });
    fireEvent.click(option.querySelector("button") as HTMLButtonElement);

    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    const link = await screen.findByRole("link", { name: /go to the existing record/i });
    expect(link).toHaveAttribute("href", "#record-r1");
  });

  it("renders no jump link on a component_grain_overlap conflict (plural existingIds)", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Overlaps existing component-grain records.",
      conflict: { kind: "component_grain_overlap", existingIds: ["r1", "r2"], packageName: "@acme/old" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /source: none selected/i }));
    const option = await screen.findByRole("option", { name: /^@acme\/old/ });
    fireEvent.click(option.querySelector("button") as HTMLButtonElement);

    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/overlaps existing component-grain records/i);
    expect(screen.queryByRole("link", { name: /go to the existing record/i })).not.toBeInTheDocument();
  });
});
