// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import { GovernanceManager } from "@/components/governance/governance-manager";

vi.mock("@/app/governance/governance-actions", () => ({
  saveGovernance: vi.fn(async () => ({ ok: true, id: "new" })),
  deleteGovernance: vi.fn(async () => ({ ok: true })),
}));

Element.prototype.scrollIntoView = vi.fn();

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
  r1: { status: "active", left: 4, leftIn: ["repo-a", "repo-b"], componentIds: [], trackingId: "migration:r1", successorDeprecated: false },
  r2: { status: "unseen", left: 0, leftIn: [], componentIds: [], trackingId: null, successorDeprecated: false },
} satisfies Record<string, RecordStat>;

describe("GovernanceManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows superseded and retired records in their own tables with the form's column headings", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} notice={null} />);
    const superseded = screen.getByRole("table", { name: "Superseded" });
    expect(within(superseded).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Package or component",
      "Superseded by",
      "Status",
      "Edit",
    ]);
    expect(within(superseded).getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
    const retired = screen.getByRole("table", { name: "Retired" });
    expect(within(retired).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Package or component",
      "Reason",
      "Status",
      "Edit",
    ]);
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
    expect(screen.getByRole("heading", { name: "Edit record" })).toBeInTheDocument();
  });

  it("shows where a deprecated successor goes next", () => {
    const chain: GovernanceRecord[] = [
      { ...(records[0] as GovernanceRecord), id: "a", targetExport: "TextField", disposition: { kind: "superseded", by: { packageName: "@acme/old", exportName: "Input" } } },
      { ...(records[0] as GovernanceRecord), id: "b", targetExport: "Input", disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Input" } } },
    ];
    const chainStats = { a: { status: "active", left: 1, leftIn: ["repo-a"], componentIds: [], trackingId: "migration:a", successorDeprecated: true } as RecordStat };
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

  it("labels the form's fields in plain words, with hints", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.getByRole("heading", { name: "New record" })).toBeInTheDocument();
    expect(screen.getByText("Package or component")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByText("Superseded: something replaces it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Retired" }));
    expect(screen.getByText("Retired: it goes with no replacement.")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).not.toHaveAttribute("placeholder");
    expect(screen.getByText("Shown on the record, for example why there's no replacement.")).toBeInTheDocument();
  });

  it("marks both empty pickers invalid on Create", async () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findAllByRole("alert");
    expect(screen.getByRole("button", { name: /^Package or component:/ })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /^Superseded by:/ })).toHaveAttribute("aria-invalid", "true");
  });

  it("names the source picker with its current selection state", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.getByRole("button", { name: "Package or component: none selected" })).toBeInTheDocument();
  });

  it("opens the form via Add record for a non-empty registry, closing an open edit form", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.queryByRole("heading", { level: 2, name: "New record" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New record" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit record" })).not.toBeInTheDocument();
  });

  it("opens the form automatically on an empty registry, and Cancel reveals the teaching copy which Add record can reopen from", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    expect(screen.getByRole("heading", { level: 2, name: "New record" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { level: 2, name: "New record" })).not.toBeInTheDocument();
    expect(screen.getByText("No lifecycle records yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New record" })).toBeInTheDocument();
  });

  it("opens Edit in the record's row and moves focus into the form", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    const row = document.getElementById("record-r1");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("heading", { level: 3, name: "Edit record" })).toBeInTheDocument();
    expect(row?.contains(document.activeElement)).toBe(true);
    expect(within(row as HTMLElement).getByRole("button", { name: /^Package or component: Button · @acme\/old$/ })).toBeInTheDocument();
  });

  it("deletes from the edit form after a confirm, then focuses Add record", async () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAccessibleDescription("Delete this record?");
    const { deleteGovernance } = await import("@/app/governance/governance-actions");
    expect(deleteGovernance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteGovernance).toHaveBeenCalledWith("r1"));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Edit record" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Add record" })).toHaveFocus();
  });

  it("keeps the edited row on screen while the search hides its record", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "chip" } });
    expect(screen.getByRole("heading", { name: "Edit record" })).toBeInTheDocument();
  });

  it("keeps the search box while a search is set, even once one record is left", () => {
    const { rerender } = render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    rerender(<GovernanceManager records={[records[1] as GovernanceRecord]} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    expect(screen.getByRole("searchbox")).toHaveValue("button");
  });

  it("clears the search and highlights the saved record once it appears", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({ ok: true, id: "r1" });
    const { rerender } = render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "chip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Edit record" })).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox")).toHaveValue("");
    rerender(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} notice={null} />);
    await vi.waitFor(() => expect(document.getElementById("record-r1")).toHaveAttribute("aria-current", "true"));
    fireEvent.pointerDown(document.body);
    expect(document.getElementById("record-r1")).not.toHaveAttribute("aria-current");
  });

  it("renders the jump link to the existing record on a target_governed conflict", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Package or component: none selected" }));
    const option = await screen.findByRole("option", { name: /^@acme\/old/ });
    fireEvent.click(option.querySelector("button") as HTMLButtonElement);

    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    const link = await screen.findByRole("link", { name: /go to the existing record/i });
    expect(link).toHaveAttribute("href", "#record-r1");
  });

  it("opens a folded group to show the existing record the conflict link goes to", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });
    const done = { ...stats, r1: { ...stats.r1, status: "complete" } as RecordStat };
    render(<GovernanceManager records={[records[0] as GovernanceRecord]} sources={sources} stats={done} repoCount={3} summary={null} notice={null} />);
    expect(document.getElementById("record-r1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    fireEvent.click(screen.getByRole("button", { name: "Package or component: none selected" }));
    const option = await screen.findByRole("option", { name: /^@acme\/old/ });
    fireEvent.click(option.querySelector("button") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("radio", { name: "Retired" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(await screen.findByRole("link", { name: /go to the existing record/i }));

    await vi.waitFor(() => expect(document.getElementById("record-r1")).not.toBeNull());
    expect(screen.getByRole("button", { name: /@acme\/old/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("renders no jump link on a component_grain_overlap conflict (plural existingIds)", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Overlaps existing component-grain records.",
      conflict: { kind: "component_grain_overlap", existingIds: ["r1", "r2"], packageName: "@acme/old" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Package or component: none selected" }));
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
