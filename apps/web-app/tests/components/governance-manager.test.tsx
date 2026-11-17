// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import { GovernanceManager } from "@/components/governance/governance-manager";
import { ANNOUNCE_AFTER_MS } from "@/components/grouped-search";

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

/** Opens the New record dialog. */
async function addRecord() {
  fireEvent.click(screen.getByRole("button", { name: "Add record" }));
  return screen.findByRole("dialog", { name: "New record" });
}

const searchBox = (field: string) => screen.getByRole("searchbox", { name: field });
/** The list a search box filters. */
const results = (field: string) => document.getElementById(searchBox(field).getAttribute("aria-controls") ?? "") as HTMLElement;

/** Types into a search box and picks the row named `name` from its list. */
function pick(field: string, query: string, name: RegExp) {
  fireEvent.change(searchBox(field), { target: { value: query } });
  fireEvent.click(within(results(field)).getByRole("button", { name }));
}

/** Picks all of @acme/old as the source from its package row, listed before anything is typed. */
function pickAcmeOldPackage() {
  fireEvent.click(within(results("Package or component")).getByRole("button", { name: /^@acme\s*\/old$/ }));
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

  it("shows someone who can't edit the records with no Add record or Edit, and says only Editors can change them", () => {
    render(<GovernanceManager canEdit={false} records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(row("r1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Add record|Edit )/ })).toBeNull();
    expect(screen.getByText("View only").nextElementSibling?.textContent).toBe("Only Editors can add or change records and tags.");
  });

  it("doesn't open the record form for someone who can't edit when there are no records", () => {
    render(<GovernanceManager canEdit={false} records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(screen.getByText("No records yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows one Records table with the name, replacement or reason, and uses left columns", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
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
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    const button = row("r1");
    expect(button.children[1]?.textContent).toBe("Replaced by");
    expect(button.children[2]?.textContent).toContain("Button · @acme/new");
    const chip = row("r2");
    expect(chip.children[1]?.textContent).toBe("Retired");
    expect(within(chip).getByTitle("No replacement")).toBeInTheDocument();
  });

  it("links each count to the record's trend, named by its visible text and the record", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
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
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={1} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(screen.getByRole("link", { name: "17 left , trend for Field" })).toBeInTheDocument();
    expect(countText(row("r3"))).not.toContain("repo-a");
  });

  it("shows each package's total as plain text in its header", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const header = groupHeader("@acme/old");
    expect(header.textContent).toContain("@acme/old · 2 components");
    expect(countText(header)).toContain("23");
    expect(countText(header)).toContain("in 2 repos");
    expect(countCell(header).querySelector("a")).toBeNull();
    expect(countText(groupHeader("@acme/forms"))).toContain("in repo-a");
  });

  it("links a name to its component page, or its package page for a whole package, and leaves it plain when nothing is left to show", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
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
    render(<GovernanceManager canEdit records={records} sources={sources} stats={plain} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(within(groupHeader("@acme/old")).getByText("@acme/old")).toBeInTheDocument();
    expect(within(groupHeader("@acme/old")).queryByRole("link", { name: "@acme/old" })).toBeNull();
  });

  it("shows no data in every count and total while results are rebuilding", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
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
    render(<GovernanceManager canEdit records={records} sources={sources} stats={rest} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(countText(row("r2"))).toBe("No data");
    expect(countText(groupHeader("@acme/old"))).toBe("No data");
    expect(screen.getByRole("link", { name: "20 left in 2 repos , trend for Button" })).toBeInTheDocument();
    expect(countText(groupHeader("@acme/forms"))).toContain("17");
  });

  it("folds finished packages behind Show N complete, which opens with each package open, and each still folds from its own button", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const toggle = screen.getByRole("button", { name: "Show 1 complete" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(row("r-done")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "1 complete" })).toHaveAttribute("aria-expanded", "true");
    const fold = screen.getByRole("button", { name: "Records in @legacy/ui" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(within(row("r-done")).getByRole("link", { name: "None left , trend for OldThing" })).toHaveAttribute(
      "href",
      "/charts/retirement%3Ar-done",
    );
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(row("r-done")).toBeNull();
  });

  it("starts every package folded and opens and folds one from its own button, and a search shows matches in a folded package, without fold buttons, until it's cleared", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
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
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(row("r3")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Records in @acme/forms" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Records in @acme/old" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.pointerDown(document.body);
    expect(row("r3")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Records in @acme/forms" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the complete section, without its toggle, while a search matches a finished package", () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "oldthing" } });
    expect(screen.getByText("1 complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete/ })).toBeNull();
    expect(row("r-done")).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Show 1 complete" })).toHaveAttribute("aria-expanded", "false");
  });

  it("marks, scrolls to and focuses a record linked from another page, opening the complete section", () => {
    window.location.hash = "#record-r-done";
    render(<GovernanceManager canEdit records={records} sources={sources} stats={stats} repoCount={3} summary={null} authors={{}} notice={null} />);
    const done = row("r-done");
    expect(done).toHaveAttribute("aria-current", "true");
    expect(done).toHaveClass("selected");
    expect(done.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(document.activeElement).toBe(within(done).getByRole("link", { name: "OldThing" }));
    expect(screen.getByRole("button", { name: "1 complete" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows where a deprecated successor goes next", () => {
    const chain: GovernanceRecord[] = [
      { ...(records[0] as GovernanceRecord), id: "a", targetExport: "TextField", disposition: { kind: "superseded", by: { packageName: "@acme/old", exportName: "Input" } } },
      { ...(records[0] as GovernanceRecord), id: "b", targetExport: "Input", disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Input" } } },
    ];
    const chainStats = { a: { status: "active", left: 1, leftIn: ["repo-a"], componentIds: [], trackingId: "migration:a", successorDeprecated: true } as RecordStat };
    render(<GovernanceManager canEdit records={chain} sources={sources} stats={chainStats} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    expect(screen.getByText("Replacement deprecated")).toBeInTheDocument();
    expect(screen.getByText("→ Input · @acme/new")).toBeInTheDocument();
  });

  it("reports every invalid field inline as an alert on submit", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));
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
  ] as const)("says why there is nothing to search when the stored results are %s", async (state, text) => {
    render(<GovernanceManager canEdit records={[]} sources={[]} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} sourcesUnavailable={state} />);
    await addRecord();
    expect(within(results("Package or component")).getByText(text).closest("[aria-hidden]")).toBeNull();
  });

  it("labels the form's fields in plain words, with hints", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(await addRecord()).toHaveAccessibleDescription("Its uses show as deprecated in every repo.");
    expect(screen.getByText("Package or component")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "What should teams do instead?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Move to a replacement" })).toHaveAccessibleDescription("Each use points to what to use instead.");
    const retire = screen.getByRole("radio", { name: "Retire it" });
    expect(retire).toHaveAccessibleDescription("There's no replacement. Say why, so teams know what to do.");
    fireEvent.click(retire);
    expect(screen.queryByRole("searchbox", { name: "Replacement" })).toBeNull();
    expect(screen.getByLabelText("Reason")).not.toHaveAttribute("placeholder");
    expect(screen.getByLabelText("Reason")).toHaveAccessibleDescription("Shown on the record.");
  });

  it("marks both empty pickers invalid on Create", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));
    await screen.findAllByRole("alert");
    expect(searchBox("Package or component")).toHaveAttribute("aria-invalid", "true");
    expect(searchBox("Replacement")).toHaveAttribute("aria-invalid", "true");
  });

  it("names the source search box after its label, empty before a pick", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    expect(searchBox("Package or component")).toHaveValue("");
  });

  it("shows a picked component as a card, moves focus to what teams should do instead, and Change searches again keeping the other answers", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    pick("Package or component", "star", /^Star/);
    const card = screen.getByRole("group", { name: "Package or component" });
    expect(card).toHaveTextContent("Starold-icons · Component");
    expect(screen.queryByRole("searchbox", { name: "Package or component" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Move to a replacement" })).toHaveFocus();

    fireEvent.click(screen.getByRole("radio", { name: "Retire it" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Gone" } });
    fireEvent.click(within(card).getByRole("button", { name: "Change" }));
    const source = searchBox("Package or component");
    expect(source).toHaveFocus();
    expect(source).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Retire it" })).toBeChecked();
    expect(screen.getByLabelText("Reason")).toHaveValue("Gone");

    pickAcmeOldPackage();
    expect(screen.getByRole("group", { name: "Package or component" })).toHaveTextContent("@acme/oldWhole package · 1 component");
    expect(screen.getByText("Marks the only component in @acme/old as deprecated.")).toBeInTheDocument();
  });

  it("opens a package's components in place from its count, and picks a component from its row", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    const disclosure = within(results("Package or component")).getByRole("button", { name: "Show the 2 components in old-icons" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const opened = document.getElementById(disclosure.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(within(opened).getAllByRole("button").map((b) => b.textContent)).toEqual(["Star old-icons", "Heart old-icons"]);
    fireEvent.click(within(opened).getByRole("button", { name: /^Heart/ }));
    expect(screen.getByRole("group", { name: "Package or component" })).toHaveTextContent("Heartold-icons · Component");
  });

  it("keeps a package or component that already has a record in the list, saying why, and picks nothing from it", async () => {
    const star = rec("r-star", "old-icons", "Star", { kind: "retired", reason: "Gone" });
    render(<GovernanceManager canEdit records={[star]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    const whole = within(results("Package or component")).getByRole("button", { name: /^old-icons\s*1 component already recorded$/ });
    expect(whole).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(whole);
    fireEvent.change(searchBox("Package or component"), { target: { value: "star" } });
    const component = within(results("Package or component")).getByRole("button", { name: /^Star old-icons\s*Already recorded$/ });
    expect(component).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(component);
    expect(screen.queryByRole("group", { name: "Package or component" })).toBeNull();
    expect(searchBox("Package or component")).toHaveValue("star");
  });

  it("does nothing on Enter in a search box, and Escape there clears the search before it closes the dialog", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    const source = searchBox("Package or component");
    fireEvent.change(source, { target: { value: "star" } });
    expect(fireEvent.keyDown(source, { key: "Enter" })).toBe(false);
    fireEvent.keyDown(source, { key: "Escape" });
    expect(source).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "New record" })).toBeInTheDocument();
    fireEvent.keyDown(source, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says how many results a search lists once typing pauses", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    vi.useFakeTimers();
    try {
      fireEvent.change(searchBox("Package or component"), { target: { value: "star" } });
      act(() => vi.advanceTimersByTime(ANNOUNCE_AFTER_MS - 1));
      expect(statuses()).not.toContain("2 results");
      act(() => vi.advanceTimersByTime(1));
      expect(statuses()).toContain("2 results");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the dialog only from Add record, with no records showing the empty state, and Cancel closes it", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("No records yet.")).toBeInTheDocument();

    await addRecord();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("No records yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add record" })).toHaveFocus();
  });

  it("opens Edit in a dialog filled in from the record, and Cancel returns focus to its Edit button", async () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit record" });
    const replacement = within(dialog).getByRole("group", { name: "Replacement" });
    await vi.waitFor(() => expect(within(replacement).getByRole("button", { name: "Change" })).toHaveFocus());
    expect(within(dialog).getByRole("group", { name: "Package or component" })).toHaveTextContent("Button@acme/old · Component");
    expect(within(dialog).getByRole("radio", { name: "Move to a replacement" })).toBeChecked();
    expect(replacement).toHaveTextContent("Button@acme/new · Component");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit Button" })).toHaveFocus();
  });

  it("asks before closing with unsaved changes, from Esc, Cancel or the close button, and Keep editing or Discard answers", async () => {
    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    const dialog = await addRecord();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await addRecord();
    pick("Package or component", "star", /^Star/);
    for (const close of [
      () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }),
      () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
      () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
    ]) {
      close();
      const keep = await screen.findByRole("button", { name: "Keep editing" });
      expect(keep).toHaveAccessibleDescription("Discard this record?");
      expect(screen.queryByRole("button", { name: "Create record" })).toBeNull();
      fireEvent.click(keep);
      expect(screen.queryByText("Discard this record?")).toBeNull();
      expect(screen.getByRole("dialog", { name: "New record" })).toHaveTextContent("Star");
    }
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    expect(saveGovernance).not.toHaveBeenCalled();
  });

  it("says who added and changed a record in its edit form, and nothing in a new record's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    try {
      const changed = records.map((r) =>
        r.id === "r1" ? { ...r, createdAt: "2026-10-02T09:00:00.000Z", updatedAt: "2026-10-03T09:00:00.000Z" } : r,
      );
      const authors = { r1: { createdBy: "Ana", updatedBy: "Sam" } };
      render(<GovernanceManager canEdit records={changed} sources={sources} stats={{}} repoCount={3} summary={null} authors={authors} notice={null} />);
      openPackages();
      fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
      expect(await screen.findByRole("dialog", { name: "Edit record" })).toHaveAccessibleDescription(
        "Added by Ana on 2 Oct · changed by Sam on 3 Oct",
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await addRecord();
      expect(screen.queryByText(/^Added/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes from the edit form after a confirm, then focuses Add record", async () => {
    render(<GovernanceManager canEdit records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    openPackages();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAccessibleDescription("Delete this record?");
    const { deleteGovernance } = await import("@/app/governance/governance-actions");
    expect(deleteGovernance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteGovernance).toHaveBeenCalledWith("r1"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Add record" })).toHaveFocus();
  });

  it("keeps the search box while a search is set, even once one record is left", () => {
    const { rerender } = render(<GovernanceManager canEdit records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    rerender(<GovernanceManager canEdit records={[records[1] as GovernanceRecord]} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(screen.getByRole("searchbox")).toHaveValue("button");
  });

  it("clears the search and highlights the saved record once it appears", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({ ok: true, id: "r1" });
    const { rerender } = render(<GovernanceManager canEdit records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Edit record" })).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox")).toHaveValue("");
    rerender(<GovernanceManager canEdit records={records} sources={sources} stats={{}} repoCount={3} summary={null} authors={{}} notice={null} />);
    await vi.waitFor(() => expect(document.getElementById("record-r1")).toHaveAttribute("aria-current", "true"));
    fireEvent.pointerDown(document.body);
    expect(document.getElementById("record-r1")).not.toHaveAttribute("aria-current");
  });

  it("keeps the dialog open after Create, saying what was added, with both search boxes blank and the choice kept", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    const { rerender } = render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    pick("Package or component", "star", /^Star/);
    pick("Replacement", "@acme/new", /^Button/);
    expect(within(screen.getByRole("group", { name: "Replacement" })).getByRole("button", { name: "Change" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));

    await vi.waitFor(() => expect(statuses()).toContain("1 added · last Star"));
    expect(saveGovernance).toHaveBeenCalledWith({
      grain: "component",
      targetPackage: "old-icons",
      targetExport: "Star",
      disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } },
    });
    expect(screen.getByRole("dialog", { name: "New record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    const source = searchBox("Package or component");
    expect(source).toHaveValue("");
    await vi.waitFor(() => expect(source).toHaveFocus());
    expect(source).toHaveAttribute("placeholder", "Search packages and components");
    expect(searchBox("Replacement")).toHaveValue("");
    expect(searchBox("Replacement")).toHaveAttribute("placeholder", "Search for a replacement");

    const created = rec("new", "old-icons", "Star", { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } });
    rerender(<GovernanceManager canEdit records={[created]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));
    expect(await screen.findByText("Choose a package or component.")).toBeInTheDocument();
    expect(screen.getByText("Choose a replacement.")).toBeInTheDocument();
    expect(saveGovernance).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: "Retire it" }));
    pickAcmeOldPackage();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));
    await vi.waitFor(() => expect(statuses()).toContain("2 added · last @acme/old"));
    expect(saveGovernance).toHaveBeenLastCalledWith({
      grain: "package",
      targetPackage: "@acme/old",
      targetExport: null,
      disposition: { kind: "retired", reason: "Gone" },
    });
    expect(screen.getByRole("radio", { name: "Retire it" })).toBeChecked();
    expect(screen.getByLabelText("Reason")).toHaveValue("");

    const show = screen.getByRole("button", { name: "Show" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
    const added = screen.getByRole("list", { name: "Added in this session" });
    expect(show).toHaveAttribute("aria-controls", added.id);
    expect(within(added).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Star old-icons → Button @acme/new",
      "@acme/old · Retired",
    ]);
  });

  it("renders the jump link to the existing record on a target_governed conflict", async () => {
    const { saveGovernance } = await import("@/app/governance/governance-actions");
    vi.mocked(saveGovernance).mockResolvedValueOnce({
      ok: false,
      error: "Already governed.",
      conflict: { kind: "target_governed", existingId: "r1" },
    });

    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    pickAcmeOldPackage();

    fireEvent.click(screen.getByRole("radio", { name: "Retire it" }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));

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
    render(<GovernanceManager canEdit records={[records[0] as GovernanceRecord]} sources={sources} stats={done} repoCount={3} summary={null} authors={{}} notice={null} />);
    expect(document.getElementById("record-r1")).toBeNull();

    await addRecord();
    pick("Package or component", "star", /^Star/);
    fireEvent.click(screen.getByRole("radio", { name: "Retire it" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));
    fireEvent.click(await screen.findByRole("link", { name: /go to the existing record/i }));

    await vi.waitFor(() => expect(document.getElementById("record-r1")).not.toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
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

    render(<GovernanceManager canEdit records={[]} sources={sources} stats={{}} repoCount={0} summary={null} authors={{}} notice={null} />);
    await addRecord();
    pickAcmeOldPackage();

    fireEvent.click(screen.getByRole("radio", { name: "Retire it" }));
    fireEvent.change(await screen.findByLabelText(/reason/i), { target: { value: "gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create record" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/overlaps existing component-grain records/i);
    expect(screen.queryByRole("link", { name: /go to the existing record/i })).not.toBeInTheDocument();
  });
});
