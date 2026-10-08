// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CohortSeries, DashboardConfig, DashboardScope, GovernanceRule, GovernanceTracking } from "@scoutui/web-shared";
import { TrackingList } from "@/components/dashboards/tracking-list";

type SparklineProps = { uid: string; config: DashboardConfig; view: { series: CohortSeries[] } };
const sparklines = vi.hoisted(() => [] as SparklineProps[]);
vi.mock("@/components/dashboards/dashboard-sparkline", () => ({
  DashboardSparkline: (props: SparklineProps) => {
    sparklines.push(props);
    return null;
  },
}));

const scrollIntoView = Element.prototype.scrollIntoView;
afterEach(() => {
  cleanup();
  sparklines.length = 0;
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
});

const component = (targetPackage: string, targetExport: string): GovernanceRule => ({ grain: "component", targetPackage, targetExport });

function entry(id: string, from: GovernanceRule[], over: Partial<GovernanceTracking> = {}): GovernanceTracking {
  return {
    id: `migration:${id}`,
    kind: "migration",
    record: { targetPackage: from[0]?.targetPackage } as never,
    recordIds: [id],
    name: `Migration: ${id}`,
    from,
    fromLabel: from.map((rule) => `${rule.targetExport ?? rule.targetPackage} · ${rule.targetPackage}`).join(", "),
    toLabel: "@example/ui",
    config: { scope: { kind: "all" }, cohorts: [], chartType: "trend", metric: "count" },
    series: [],
    lines: null,
    coverage: { total: 1, repoIds: ["checkout"], points: [] },
    active: true,
    remaining: 5,
    progress: 0.5,
    delta: 0,
    reposAdded: 0,
    ...over,
  };
}

const done = { active: false, remaining: 0, progress: 1 } as const;
const all: DashboardScope = { kind: "all" };
const fold = (packageName: string) => screen.getByRole("button", { name: packageName });
const rowNames = () => screen.queryAllByRole("link").map((link) => link.querySelector(".font-mono")?.textContent);

describe("TrackingList", () => {
  it("groups entries under their old package, most uses left first, each folded", () => {
    render(
      <TrackingList
        scope={all}
        entries={[
          entry("a", [component("@example/forms", "Input")], { remaining: 30 }),
          entry("b", [component("@example/legacy", "Button")], { remaining: 20 }),
          entry("c", [component("@example/legacy", "Card")], { remaining: 25 }),
        ]}
      />,
    );
    const folds = screen.getAllByRole("button", { expanded: false });
    expect(folds.map((button) => button.textContent)).toEqual(["@example/legacy", "@example/forms"]);
    expect(within(fold("@example/legacy").closest("[data-slot=package-row]") as HTMLElement).getAllByText("45").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("starts a lone package folded too", () => {
    render(<TrackingList scope={all} entries={[entry("a", [component("@example/legacy", "Button")])]} />);
    expect(fold("@example/legacy")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("opens a package onto every entry in it, most uses left first, named in full without the package", () => {
    const parts = ["Modal", "ModalBody", "ModalCloseButton", "ModalFooter", "ModalHeader", "ModalTitle"];
    render(
      <TrackingList
        scope={all}
        entries={[
          ...Array.from({ length: 11 }, (_, i) => entry(`e${i}`, [component("@example/legacy", `Part${i}`)], { remaining: i + 1 })),
          entry("modal", parts.map((name) => component("@example/legacy", name)), { remaining: 40, toLabel: "@example/ui-modal" }),
          entry("gone", [component("@example/legacy", "Toast")], { kind: "retirement", toLabel: null, progress: null, remaining: 3 }),
        ]}
      />,
    );
    fireEvent.click(fold("@example/legacy"));
    expect(rowNames()).toHaveLength(13);
    expect(rowNames()[0]).toBe(parts.join(", "));
    expect(rowNames().slice(1, 3)).toEqual(["Part10", "Part9"]);
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("to @example/ui-modal");
    expect(screen.getByRole("link", { name: /Toast/ })).toHaveTextContent("Retired");
    expect(screen.queryByText(/Show all/)).toBeNull();
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it("shows a package one entry covers whole as that entry's row, with no fold", () => {
    const whole: GovernanceRule = { grain: "package", targetPackage: "@example/icons-v1", targetExport: null };
    render(
      <TrackingList
        scope={all}
        entries={[
          entry("icons", [whole], { toLabel: "@example/icons-v2" }),
          entry("b", [component("@example/legacy", "Button")]),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "@example/icons-v1" })).toBeNull();
    expect(screen.getByRole("link", { name: /@example\/icons-v1/ })).toHaveAttribute("href", "/charts/migration%3Aicons");
    expect(fold("@example/legacy")).toBeInTheDocument();
  });

  it("lists an entry covering two packages under its oldest record's package, naming each package", () => {
    render(
      <TrackingList
        scope={all}
        entries={[entry("both", [component("@example/forms", "Button"), component("@example/legacy", "Button")], { record: { targetPackage: "@example/legacy" } as never })]}
      />,
    );
    expect(screen.queryByRole("button", { name: "@example/forms" })).toBeNull();
    fireEvent.click(fold("@example/legacy"));
    expect(rowNames()).toEqual(["Button · @example/forms, Button · @example/legacy"]);
  });

  it("reads each row's change in uses left in colour, with the repos added", () => {
    render(
      <TrackingList
        scope={all}
        entries={[
          entry("fewer", [component("@example/legacy", "A")], { delta: -3, reposAdded: 1 }),
          entry("more", [component("@example/legacy", "B")], { delta: 2 }),
          entry("still", [component("@example/legacy", "C")], { delta: 0 }),
        ]}
      />,
    );
    fireEvent.click(fold("@example/legacy"));
    expect(within(screen.getByRole("link", { name: /^A/ })).getAllByText("3 fewer")[0]).toHaveClass("text-status-ok");
    expect(within(screen.getByRole("link", { name: /^B/ })).getAllByText("2 more")[0]).toHaveClass("text-status-err");
    expect(within(screen.getByRole("link", { name: /^C/ })).getAllByText("no change")[0]).not.toHaveClass("text-status-ok", "text-status-err");
    expect(within(screen.getByRole("link", { name: /^A/ })).getAllByText("1 repo added").length).toBeGreaterThan(0);
  });

  it("totals a package's change and trend over every entry in it, finished ones too", () => {
    const at = (t: string, value: number) => ({ t, value });
    const deprecated = (key: string, points: Array<{ t: string; value: number }>): CohortSeries => ({ cohortKey: key, label: key, color: "", role: "deprecated", points });
    render(
      <TrackingList
        scope={all}
        entries={[
          entry("a", [component("@example/legacy", "A")], { delta: -3, remaining: 4, series: [deprecated("a", [at("2026-01-01", 7), at("2026-01-03", 4)])] }),
          entry("b", [component("@example/legacy", "B")], { ...done, delta: -2, series: [deprecated("b", [at("2026-01-02", 2), at("2026-01-03", 0)])] }),
        ]}
      />,
    );
    const row = fold("@example/legacy").closest("[data-slot=package-row]") as HTMLElement;
    expect(within(row).getAllByText("5 fewer").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("4").length).toBeGreaterThan(0);
    const trend = sparklines.find((props) => props.uid === "package-@example/legacy");
    expect(trend?.view.series.map((s) => s.points)).toEqual([[at("2026-01-01", 7), at("2026-01-02", 9), at("2026-01-03", 4)]]);
  });

  it("switches between entries in progress and complete, and hides the switch when nothing is complete", () => {
    const entries = [
      entry("a", [component("@example/legacy", "Button")]),
      entry("b", [component("@example/legacy", "Card")], done),
    ];
    render(<TrackingList scope={all} entries={entries} />);
    expect(screen.getByRole("button", { name: "In progress 1" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Complete 1" }));
    fireEvent.click(fold("@example/legacy"));
    expect(rowNames()).toEqual(["Card"]);
    cleanup();
    render(<TrackingList scope={all} entries={[entries[0] as GovernanceTracking]} />);
    expect(screen.queryByRole("button", { name: /Complete/ })).toBeNull();
  });

  it("starts on the complete side when nothing is in progress", () => {
    render(<TrackingList scope={all} entries={[entry("b", [component("@example/legacy", "Card")], done)]} />);
    expect(screen.getByRole("button", { name: "Complete 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers a search past 10 entries that opens the packages it matches and counts each side", () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => entry(`e${i}`, [component("@example/forms", `Field${i}`)])),
      entry("btn", [component("@example/legacy", "Button")]),
      entry("old-btn", [component("@example/forms", "IconButton")], done),
    ];
    render(<TrackingList scope={all} entries={entries.slice(0, 10)} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    cleanup();
    render(<TrackingList scope={all} entries={entries} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a component or package" }), { target: { value: "button" } });
    expect(rowNames()).toEqual(["Button"]);
    expect(screen.getByRole("button", { name: "In progress 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete 1" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing-like-it" } });
    expect(screen.getByText(/Nothing matches/)).toHaveTextContent("Nothing matches nothing-like-it.");
  });

  it.each([
    { scope: all, heading: "Migrations and retirements", query: "" },
    { scope: { kind: "repo", repoId: "example/web" } as const, heading: "Migrations and retirements in this repo", query: "?repo=example/web" },
  ])("names its heading, links each row and draws each package's trend for $scope.kind", ({ scope, heading, query }) => {
    const whole: GovernanceRule = { grain: "package", targetPackage: "@example/icons-v1", targetExport: null };
    render(<TrackingList scope={scope} entries={[entry("icons", [whole]), entry("b", [component("@example/legacy", "Button")])]} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(heading);
    expect(screen.getByRole("link", { name: /@example\/icons-v1/ })).toHaveAttribute("href", `/charts/migration%3Aicons${query}`);
    expect(sparklines.find((props) => props.uid === "package-@example/legacy")?.config.scope).toEqual(scope);
  });

  it("brings the page back to a package's row when it's folded from below", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<TrackingList scope={all} entries={[entry("a", [component("@example/legacy", "A")])]} />);
    fireEvent.click(fold("@example/legacy"));
    const row = fold("@example/legacy").closest("[data-slot=package-row]") as HTMLElement;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { top: this === row ? 57 : -400 } as DOMRect;
    });
    fireEvent.click(fold("@example/legacy"));
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled.mock.contexts[0]).toBe(row);
  });

  it("leaves the page where it is when a package is folded from its own row", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<TrackingList scope={all} entries={[entry("a", [component("@example/legacy", "A")])]} />);
    fireEvent.click(fold("@example/legacy"));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: 120 }) as DOMRect);
    fireEvent.click(fold("@example/legacy"));
    expect(scrolled).not.toHaveBeenCalled();
  });
});
