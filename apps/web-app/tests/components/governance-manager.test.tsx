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

function rec(
  id: string,
  targetPackage: string,
  targetExport: string | null,
  disposition: GovernanceRecord["disposition"],
): GovernanceRecord {
  return {
    id,
    grain: targetExport === null ? "package" : "component",
    targetPackage,
    targetExport,
    disposition,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const records: GovernanceRecord[] = [
  rec("r1", "@acme/old", "Button", { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } }),
  rec("r2", "@acme/old", "Chip", { kind: "retired", reason: "No replacement" }),
  rec("r3", "@acme/forms", "Field", { kind: "superseded", by: { packageName: "@acme/new", exportName: "Input" } }),
  rec("r4", "@acme/forms", "Select", { kind: "retired", reason: "Use a native select" }),
  rec("r-icons", "old-icons", null, { kind: "superseded", by: { packageName: "new-icons" } }),
  rec("r-done", "@legacy/ui", "OldThing", { kind: "retired", reason: "Gone" }),
];

const sources = [
  { packageName: "@acme/old", exportName: "Button", occurrences: 3 },
  { packageName: "@acme/new", exportName: "Button", occurrences: 1 },
  { packageName: "old-icons", exportName: "Star", occurrences: 4 },
  { packageName: "old-icons", exportName: "Heart", occurrences: 2 },
];

const statuses = () => screen.getAllByRole("status").map((s) => s.textContent);

/** Types into a search box and presses Enter, which picks the first component it can. */
function pick(field: string, query: string) {
  const box = screen.getByRole("combobox", { name: field });
  fireEvent.change(box, { target: { value: query } });
  fireEvent.keyDown(box, { key: "Enter" });
}

/** Picks all of @acme/old as the source: narrows to its package row, above the active Button row, then picks `All of`. */
function pickAcmeOldPackage() {
  const source = screen.getByRole("combobox", { name: "Package or component" });
  fireEvent.change(source, { target: { value: "@acme/old" } });
  fireEvent.keyDown(source, { key: "ArrowUp" });
  fireEvent.keyDown(source, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: /^All of @acme\/old/ }));
}

const stats = {
  r1: { status: "active", left: 20, leftIn: ["repo-a", "repo-b"], componentIds: ["c-button"], trackingId: "migration:r1", successorDeprecated: false },
  r2: { status: "active", left: 3, leftIn: ["repo-a"], componentIds: ["c-chip"], trackingId: "retirement:r2", successorDeprecated: false },
  r3: { status: "active", left: 17, leftIn: ["repo-a"], componentIds: ["c-field"], trackingId: "migration:r3", successorDeprecated: false },
  r4: { status: "unseen", left: 0, leftIn: [], componentIds: [], trackingId: null, successorDeprecated: false },
  "r-icons": { status: "active", left: 5, leftIn: ["repo-b"], componentIds: ["c-star", "c-heart"], trackingId: "migration:r-icons", successorDeprecated: false },
  "r-done": { status: "complete", left: 0, leftIn: [], componentIds: ["c-old"], trackingId: "retirement:r-done", successorDeprecated: false },
} satisfies Record<string, RecordStat>;

// jsdom applies no CSS, so link names include the stacked layout's "left" and a space at each element edge.
const row = (id: string) => document.getElementById(`record-${id}`) as HTMLElement;
const groupHeader = (packageName: string) =>
  screen.getByRole("button", { name: `Records in ${packageName}` }).closest("tr") as HTMLElement;
const countCell = (tr: HTMLElement) => tr.children[tr.children.length - 2] as HTMLElement;
const countText = (tr: HTMLElement) => countCell(tr).textContent?.trim();

/** Opens every folded package, as packages start folded. */
function openPackages() {
  for (const button of screen.queryAllByRole("button", { name: /^Records in / })) {
    if (button.getAttribute("aria-expanded") === "false") fireEvent.click(button);
  }
}

describe("GovernanceManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
  });

  it("shows one Records table with the name, replacement or reason, and uses left columns", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(screen.getByText("6 records")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Records" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Replacement or reason",
      "Uses left",
      "Edit",
    ]);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(within(table).getByRole("button", { name: "Edit Button" })).toBeInTheDocument();
  });

  it("says on every row whether the record is superseded or retired", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    const button = row("r1");
    expect(button.children[1]?.textContent).toBe("Replaced by");
    expect(button.children[2]?.textContent).toContain("Button · @acme/new");
    const chip = row("r2");
    expect(chip.children[1]?.textContent).toBe("Retired");
    expect(within(chip).getByTitle("No replacement")).toBeInTheDocument();
  });

  it("links each count to the record's trend, named by its visible text and the record", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    const button = screen.getByRole("link", { name: "20 left in 2 repos , trend for Button" });
    expect(button).toHaveAttribute("href", "/charts/migration%3Ar1");
    expect(button).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("link", { name: "17 left in repo-a , trend for Field" })).toHaveAttribute("href", "/charts/migration%3Ar3");
    expect(countText(row("r4"))).toBe("Not in any scan");
    expect(countCell(row("r4")).querySelector("svg")).not.toBeNull();
    expect(within(row("r4")).queryByRole("link", { name: /trend for/ })).toBeNull();
  });

  it("drops the repo from counts when fewer than two repos are scanned", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={1} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(screen.getByRole("link", { name: "17 left , trend for Field" })).toBeInTheDocument();
    expect(countText(row("r3"))).not.toContain("repo-a");
  });

  it("shows each package's total as plain text in its header", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const header = groupHeader("@acme/old");
    expect(header.textContent).toContain("@acme/old · 2 components");
    expect(countText(header)).toContain("23");
    expect(countText(header)).toContain("in 2 repos");
    expect(countCell(header).querySelector("a")).toBeNull();
    expect(countText(groupHeader("@acme/forms"))).toContain("in repo-a");
  });

  it("links a name to its component page, or its package page for a whole package, and leaves it plain when nothing is left to show", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(within(row("r1")).getByRole("link", { name: "Button" })).toHaveAttribute("href", "/components/c-button");
    expect(within(row("r-icons")).getByRole("link", { name: "old-icons" })).toHaveAttribute("href", "/packages/old-icons");
    expect(row("r-icons").textContent).toContain("Whole package · 2 components");
    expect(within(row("r4")).getByText("Select")).toBeInTheDocument();
    expect(within(row("r4")).queryByRole("link", { name: "Select" })).toBeNull();
    expect(within(groupHeader("@acme/old")).getByRole("link", { name: "@acme/old" })).toHaveAttribute("href", "/packages/%40acme%2Fold");
  });

  it("leaves a package name plain when none of its records covers a component", () => {
    const plain = { ...stats, r1: { ...stats.r1, componentIds: [] }, r2: { ...stats.r2, componentIds: [] } };
    render(<GovernanceManager records={records} sources={sources} stats={plain} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(within(groupHeader("@acme/old")).getByText("@acme/old")).toBeInTheDocument();
    expect(within(groupHeader("@acme/old")).queryByRole("link", { name: "@acme/old" })).toBeNull();
  });

  it("shows no data in every count and total while results are rebuilding", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    const table = screen.getByRole("table", { name: "Records" });
    const rows = [...table.querySelectorAll<HTMLElement>("tbody > tr")];
    expect(rows).toHaveLength(9);
    expect(rows.map(countText)).toEqual(Array(9).fill("No data"));
    expect(rows.filter((tr) => countCell(tr).querySelector("svg"))).toEqual([]);
    expect(within(table).queryByText("None left")).toBeNull();
    expect(within(table).queryAllByRole("link", { name: /trend for/ })).toEqual([]);
  });

  it("shows no data for a record saved since the last rebuild, and for its package's total, keeping the other counts", () => {
    const { r2: _saved, ...rest } = stats;
    render(<GovernanceManager records={records} sources={sources} stats={rest} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(countText(row("r2"))).toBe("No data");
    expect(countText(groupHeader("@acme/old"))).toBe("No data");
    expect(screen.getByRole("link", { name: "20 left in 2 repos , trend for Button" })).toBeInTheDocument();
    expect(countText(groupHeader("@acme/forms"))).toContain("17");
  });

  it("folds finished packages behind Show N complete", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const toggle = screen.getByRole("button", { name: "Show 1 complete" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(row("r-done")).toBeNull();
    fireEvent.click(toggle);
    openPackages();
    expect(screen.getByRole("button", { name: "1 complete" })).toHaveAttribute("aria-expanded", "true");
    expect(within(row("r-done")).getByRole("link", { name: "None left , trend for OldThing" })).toHaveAttribute(
      "href",
      "/charts/retirement%3Ar-done",
    );
  });

  it("starts every package folded and opens and folds one from its own button, and a search shows matches in a folded package, without fold buttons, until it's cleared", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const fold = screen.getByRole("button", { name: "Records in @acme/old" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Records in @acme/forms" })).toHaveAttribute("aria-expanded", "false");
    expect(row("r1")).toBeNull();
    expect(row("r3")).toBeNull();
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(row("r1")).not.toBeNull();
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(row("r1")).toBeNull();
    expect(groupHeader("@acme/old").textContent).toContain("23");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    expect(row("r1")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Records in/ })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(row("r1")).toBeNull();
    expect(screen.getByRole("button", { name: "Records in @acme/old" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Records in @acme/old" }));
    expect(row("r1")).not.toBeNull();
  });

  it("opens the package of a record linked from another page, leaving the other packages folded, and keeps it open once the mark clears", () => {
    window.location.hash = "#record-r3";
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(row("r3")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Records in @acme/forms" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Records in @acme/old" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.pointerDown(document.body);
    expect(row("r3")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Records in @acme/forms" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the complete section, without its toggle, while a search matches a finished package", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "oldthing" } });
    expect(screen.getByText("1 complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete/ })).toBeNull();
    expect(row("r-done")).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Show 1 complete" })).toHaveAttribute("aria-expanded", "false");
  });

  it("marks, scrolls to and focuses a record linked from another page, opening the complete section", () => {
    window.location.hash = "#record-r-done";
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const done = row("r-done");
    expect(done).toHaveAttribute("aria-current", "true");
    expect(done).toHaveClass("selected");
    expect(done.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(document.activeElement).toBe(within(done).getByRole("link", { name: "OldThing" }));
    expect(screen.getByRole("button", { name: "1 complete" })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the edit form as it is, and focus on the toggle, when the complete section folds", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 complete" }));
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit OldThing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const heading = screen.getByRole("heading", { name: "Edit record" });
    const toggle = screen.getByRole("button", { name: "1 complete" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Edit record" })).toBe(heading);
    expect(screen.getByText("Delete this record?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Records in @legacy/ui" })).toBeNull();
  });

  it("keeps the edit form as it is, and focus on the fold button, when its package folds", () => {
    render(<GovernanceManager records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const heading = screen.getByRole("heading", { name: "Edit record" });
    const fold = screen.getByRole("button", { name: "Records in @acme/old" });
    fold.focus();
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Edit record" })).toBe(heading);
    expect(screen.getByText("Delete this record?")).toBeInTheDocument();
    expect(row("r2")).toBeNull();
  });

  it("shows where a deprecated successor goes next", () => {
    const chain: GovernanceRecord[] = [
      { ...(records[0] as GovernanceRecord), id: "a", targetExport: "TextField", disposition: { kind: "superseded", by: { packageName: "@acme/old", exportName: "Input" } } },
      { ...(records[0] as GovernanceRecord), id: "b", targetExport: "Input", disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Input" } } },
    ];
    const chainStats = { a: { status: "active", left: 1, leftIn: ["repo-a"], componentIds: [], trackingId: "migration:a", successorDeprecated: true } as RecordStat };
    render(<GovernanceManager records={chain} sources={sources} stats={chainStats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(screen.getByText("Replacement deprecated")).toBeInTheDocument();
    expect(screen.getByText("→ Input · @acme/new")).toBeInTheDocument();
  });

  it("reports every invalid field inline as an alert on submit", async () => {
    // Empty registry: the form is already open (first-run), no click needed.
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((a) => a.textContent).join(" | ");
    expect(text).toMatch(/choose a package or component/i);
    expect(text).toMatch(/choose a replacement/i);
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    expect(saveGovernance).not.toHaveBeenCalled();
  });

  it.each([
    [null, "Nothing scanned yet"],
    ["preparing", "Preparing scan data"],
  ] as const)("says why there is nothing to search when the stored results are %s", (state, text) => {
    render(<GovernanceManager records={[]} sources={[]} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} sourcesUnavailable={state} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Package or component" }));
    expect(statuses()).toContain(text);
  });

  it("labels the form's fields in plain words, with hints", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(screen.getByRole("heading", { name: "New record" })).toBeInTheDocument();
    expect(screen.getByText("Package or component")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByText("Replaced: teams move to a replacement.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Retired" }));
    expect(screen.getByText("Retired: teams stop using it.")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).not.toHaveAttribute("placeholder");
    expect(screen.getByText("Shown on the record, for example why there's no replacement.")).toBeInTheDocument();
  });

  it("marks both empty pickers invalid on Create", async () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findAllByRole("alert");
    expect(screen.getByRole("combobox", { name: "Package or component" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox", { name: "Replaced by" })).toHaveAttribute("aria-invalid", "true");
  });

  it("names the source search box after its label, empty before a pick", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(screen.getByRole("combobox", { name: "Package or component" })).toHaveValue("");
  });

  it("opens the form via Add record for a non-empty registry, closing an open edit form", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(screen.queryByRole("heading", { level: 2, name: "New record" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New record" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit record" })).not.toBeInTheDocument();
  });

  it("opens the form automatically on an empty registry, and Cancel reveals the teaching copy which Add record can reopen from", () => {
    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(screen.getByRole("heading", { level: 2, name: "New record" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { level: 2, name: "New record" })).not.toBeInTheDocument();
    expect(screen.getByText("No records yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    expect(screen.getByRole("heading", { level: 2, name: "New record" })).toBeInTheDocument();
  });

  it("opens Edit in the record's row and moves focus into the form, and Cancel returns focus to its Edit button", () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    const row = document.getElementById("record-r1");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("heading", { level: 3, name: "Edit record" })).toBeInTheDocument();
    expect(row?.contains(document.activeElement)).toBe(true);
    expect(within(row as HTMLElement).getByRole("combobox", { name: "Package or component" })).toHaveValue("Button · @acme/old");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit Button" })).toHaveFocus();
  });

  it("says who added and changed a record in its edit form, and nothing in a new record's", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    try {
      const changed = records.map((r) =>
        r.id === "r1" ? { ...r, createdAt: "2026-10-02T09:00:00.000Z", updatedAt: "2026-10-03T09:00:00.000Z" } : r,
      );
      const authors = { r1: { createdBy: "Ana", updatedBy: "Sam" } };
      render(<GovernanceManager records={changed} sources={sources} stats={{}} repoCount={3} summary={null} authors={authors} notice={null} />);
      openPackages();
      fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
      expect(within(row("r1")).getByText("Added by Ana on 2 Oct · changed by Sam on 3 Oct")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add record" }));
      expect(screen.getByRole("heading", { name: "New record" })).toBeInTheDocument();
      expect(screen.queryByText(/^Added/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes from the edit form after a confirm, then focuses Add record", async () => {
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
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
    render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "chip" } });
    expect(screen.getByRole("heading", { name: "Edit record" })).toBeInTheDocument();
  });

  it("keeps the search box while a search is set, even once one record is left", () => {
    const { rerender } = render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    rerender(<GovernanceManager records={[records[1] as GovernanceRecord]} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(screen.getByRole("searchbox")).toHaveValue("button");
  });

  it("clears the search and highlights the saved record once it appears", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({ ok: true, id: "r1" });
    const { rerender } = render(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "chip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Edit record" })).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox")).toHaveValue("");
    rerender(<GovernanceManager records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    await vi.waitFor(() => expect(document.getElementById("record-r1")).toHaveAttribute("aria-current", "true"));
    fireEvent.pointerDown(document.body);
    expect(document.getElementById("record-r1")).not.toHaveAttribute("aria-current");
  });

  it("keeps the form open after Create, saying what was added, with both search boxes blank and Type kept, and blank again when closed with nothing picked", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    const { rerender } = render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    const source = screen.getByRole("combobox", { name: "Package or component" });
    fireEvent.change(source, { target: { value: "old-icons" } });
    fireEvent.keyDown(source, { key: "ArrowUp" });
    fireEvent.keyDown(source, { key: "Enter" });
    fireEvent.keyDown(source, { key: "Enter" });
    const by = screen.getByRole("combobox", { name: "Replaced by" });
    fireEvent.change(by, { target: { value: "@acme/new" } });
    fireEvent.keyDown(by, { key: "ArrowUp" });
    fireEvent.keyDown(by, { key: "Enter" });
    fireEvent.keyDown(by, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() => expect(statuses()).toContain("Star replaced by Button"));
    expect(saveGovernance).toHaveBeenCalledWith({
      grain: "component",
      targetPackage: "old-icons",
      targetExport: "Star",
      disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } },
    });
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(source).toHaveValue("");
    expect(source).toHaveFocus();
    expect(source).toHaveAttribute("placeholder", "Search packages and components");
    expect(by).toHaveValue("");
    expect(by).toHaveAttribute("placeholder", "Search for a replacement");
    expect(screen.queryByRole("button", { name: "Search all packages" })).not.toBeInTheDocument();

    const created = rec("new", "old-icons", "Star", { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } });
    rerender(<GovernanceManager records={[created]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(document.getElementById("record-new")).toHaveAttribute("aria-current", "true");

    for (const [box, packageName] of [[source, "old-icons"], [by, "@acme/new"]] as const) {
      fireEvent.change(box, { target: { value: packageName } });
      fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${packageName}`) }));
      expect(box).toHaveAccessibleDescription(packageName);
      fireEvent.blur(box);
      expect(box).toHaveValue("");
      expect(box).not.toHaveAccessibleDescription();
    }
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Choose a package or component.")).toBeInTheDocument();
    expect(screen.getByText("Choose a replacement.")).toBeInTheDocument();
    expect(saveGovernance).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: "Retired" }));
    pick("Package or component", "heart");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => expect(statuses()).toContain("Heart retired"));
    expect(screen.getByRole("radio", { name: "Retired" })).toBeChecked();
    expect(screen.getByLabelText("Reason")).toHaveValue("");
  });

  it("renders the jump link to the existing record on a target_governed conflict", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    pickAcmeOldPackage();

    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    const link = await screen.findByRole("link", { name: /go to the existing record/i });
    expect(link).toHaveAttribute("href", "#record-r1");
  });

  it("opens the complete section to show the existing record the conflict link goes to", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });
    const done = { r1: { ...stats.r1, status: "complete", left: 0, leftIn: [] } as RecordStat };
    render(<GovernanceManager records={[records[0] as GovernanceRecord]} sources={sources} stats={done} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(document.getElementById("record-r1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add record/i }));
    pick("Package or component", "star");
    fireEvent.click(screen.getByRole("radio", { name: "Retired" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(await screen.findByRole("link", { name: /go to the existing record/i }));

    await vi.waitFor(() => expect(document.getElementById("record-r1")).not.toBeNull());
    expect(screen.getByRole("button", { name: "1 complete" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("record-r1")).toHaveAttribute("aria-current", "true");
  });

  it("renders no jump link on a component_grain_overlap conflict (plural existingIds)", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Overlaps existing component-grain records.",
      conflict: { kind: "component_grain_overlap", existingIds: ["r1", "r2"], packageName: "@acme/old" },
    });

    render(<GovernanceManager records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    pickAcmeOldPackage();

    fireEvent.click(screen.getByRole("radio", { name: /retired/i }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/overlaps existing component-grain records/i);
    expect(screen.queryByRole("link", { name: /go to the existing record/i })).not.toBeInTheDocument();
  });
});
