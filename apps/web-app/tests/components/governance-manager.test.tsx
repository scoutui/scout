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

const stats = {
  r1: { status: "active", repos: 2, trackingId: "migration:r1", successorDeprecated: false },
  r2: { status: "unseen", repos: 0, trackingId: null, successorDeprecated: false },
} satisfies Record<string, RecordStat>;

describe("GovernanceManager", () => {
  it("shows superseded and retired records in their own tables with the form's column headings", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} notice={null} />);
    const superseded = screen.getByRole("table", { name: "Superseded" });
    expect(within(superseded).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Package or component", "Superseded by", "Status"]),
    );
    expect(within(superseded).getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
    const retired = screen.getByRole("table", { name: "Retired" });
    expect(within(retired).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Package or component", "Reason", "Status"]),
    );
    expect(within(retired).getByText("No replacement")).toBeInTheDocument();
  });

  it("heads a group with its source package and record count and no arrow, while record rows carry one", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} notice={null} />);
    const superseded = screen.getByRole("table", { name: "Superseded" });
    const group = within(superseded).getAllByRole("rowgroup")[1] as HTMLElement;
    const [header, row] = within(group).getAllByRole("row");
    expect(header?.textContent).toContain("@acme/old · 1 component");
    expect(header?.textContent).not.toContain("→");
    expect(header?.textContent).not.toContain("superseded by");
    expect(row?.textContent).toContain("superseded by");
    expect(row?.textContent).toContain("Button · @acme/new");
  });

  it("names each status link and edit button for its record", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} notice={null} />);
    expect(screen.getByRole("link", { name: "Button: used in 2 repos" })).toHaveAttribute("href", "/charts/migration%3Ar1");
    expect(screen.getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
    expect(screen.getByText("Never matched a scan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("collapses a group whose records are all complete, and the search opens it", () => {
    const done = { ...stats, r1: { ...stats.r1, status: "complete" } as RecordStat };
    render(<GovernanceManager records={records} sources={sources} stats={done} repoCount={3} summary={null} notice={null} />);
    const toggle = screen.getByRole("button", { name: /@acme\/old/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Edit Button" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    expect(screen.getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
  });

  it("keeps the record being edited on screen when its group collapses", () => {
    const done = { ...stats, r1: { ...stats.r1, status: "complete" } as RecordStat };
    render(<GovernanceManager records={records} sources={sources} stats={done} repoCount={3} summary={null} notice={null} />);
    const toggle = screen.getByRole("button", { name: /@acme\/old/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
  });

  it("shows where a deprecated successor goes next", () => {
    const chain: GovernanceRecord[] = [
      { ...(records[0] as GovernanceRecord), id: "a", targetExport: "TextField", disposition: { kind: "superseded", by: { packageName: "@acme/old", exportName: "Input" } } },
      { ...(records[0] as GovernanceRecord), id: "b", targetExport: "Input", disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Input" } } },
    ];
    const chainStats = { a: { status: "active", repos: 1, trackingId: "migration:a", successorDeprecated: true } as RecordStat };
    render(<GovernanceManager records={chain} sources={sources} stats={chainStats} repoCount={3} summary={null} notice={null} />);
    expect(screen.getByText("Successor deprecated")).toBeInTheDocument();
    expect(screen.getByText("→ Input · @acme/new")).toBeInTheDocument();
  });

  it("reports every invalid field inline as an alert on submit", async () => {
    // Empty registry: the form is already open (first-run), no click needed.
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((a) => a.textContent).join(" | ");
    expect(text).toMatch(/choose a package or component/i);
    expect(text).toMatch(/choose what supersedes it/i);
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    expect(saveGovernance).not.toHaveBeenCalled();
  });

  it("exposes disposition as a radiogroup whose choice swaps the dependent field", async () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    const group = screen.getByRole("radiogroup", { name: /disposition/i });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeInTheDocument();
    expect(radios).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    expect(await screen.findByLabelText(/reason/i)).toBeInTheDocument();
  });

  it("names the source picker with its current selection state", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.getByRole("button", { name: /source: none selected/i })).toBeInTheDocument();
  });

  it("opens the form via Add record for a non-empty registry", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.queryByRole("heading", { level: 2, name: "New lifecycle record" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New lifecycle record" })).toBeInTheDocument();
  });

  it("opens the form automatically on an empty registry, and Cancel reveals the teaching copy which Add record can reopen from", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.getByRole("heading", { level: 2, name: "New lifecycle record" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { level: 2, name: "New lifecycle record" })).not.toBeInTheDocument();
    expect(screen.getByText("No lifecycle records yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New lifecycle record" })).toBeInTheDocument();
  });

  it("renders the jump link to the existing record on a target_governed conflict", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
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

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
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
