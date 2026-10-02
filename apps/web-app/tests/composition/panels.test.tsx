// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentDetail, CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import { CompositionTab } from "@/components/component-detail/composition/composition-tab";

// CompositionTab's pin round-trips through useSearchParams, which needs an
// app-router context that a bare jsdom render lacks.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

vi.mock("@/components/component-detail/composition/composition-canvas", () => ({
  CompositionCanvas: () => <div data-testid="canvas-stub" />,
}));

const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id, displayName: id, packageName: null, filePath: `src/${id}.tsx`,
  scope: "local", deprecated: false, occurrenceCount: 1, ...o,
});
const detail = {
  componentId: "F", repoId: "r/x", scope: "local", displayName: "F",
  composition: { renders: [], renderedBy: [], isRootCount: 0, isLeafCount: 0 },
} as unknown as ComponentDetail;

// root0..root7 → F → ext (8 rows exercises paging at PANEL_PAGE=6).
// root6 has its own packageName for a packageName-only filter match; root5's
// default filePath ("src/root5.tsx") gives a filePath-only match.
const roots = Array.from({ length: 8 }, (_, i) =>
  node(`root${i}`, {
    occurrenceCount: 8 - i,
    ...(i === 6 ? { packageName: "@acme/marketing" } : {}),
  }),
);
const graph: CompositionGraph = {
  nodes: [...roots, node("F"), node("ext", { scope: "external", packageName: "@ui/lib", filePath: null, deprecated: true })],
  edges: [
    ...roots.map(r => ({ source: r.id, target: "F", count: 1 })),
    { source: "F", target: "ext", count: 2 },
  ],
};

describe("flat closure panels", () => {
  it("each panel is one list: header count, nearest-first step grammar, deprecated badge", () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    // The header names the list and its row count, the panel's only number.
    const renderedBy = screen.getByRole("heading", { name: "Rendered by" }).closest("header");
    expect(renderedBy).toHaveTextContent("Rendered by8");
    const renders = screen.getByRole("heading", { name: "Renders" }).closest("header");
    expect(renders).toHaveTextContent("Renders1");
    expect(screen.getAllByText("1 step").length).toBeGreaterThan(0);
    expect(screen.getByText("deprecated")).toBeInTheDocument();
    // No view toggle in either direction.
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Direct/ })).not.toBeInTheDocument();
  });

  it("both subtitles say what the list holds and what the number means", () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    expect(
      screen.getByText("everything that renders F, nearest first · the number is steps down to F"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("everything F ends up rendering, nearest first · the number is steps from F"),
    ).toBeInTheDocument();
  });

  // The list is a closure, not a neighbour list: a component three steps up
  // is in it, and the rows read outward from the focus. Within one step the
  // call sites against the focus decide (mid2 renders F 4 times, mid1 once).
  it("orders rows nearest first, most call sites against the focus first within a step", () => {
    const deepGraph: CompositionGraph = {
      nodes: [node("F"), node("mid1"), node("mid2"), node("far"), node("further")],
      edges: [
        { source: "mid1", target: "F", count: 1 },
        { source: "mid2", target: "F", count: 4 },
        { source: "far", target: "mid1", count: 1 },
        { source: "further", target: "far", count: 1 },
      ],
    };
    render(<CompositionTab detail={detail} graph={deepGraph} />);
    const rows = screen.getAllByRole("button", { name: /step/ });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "mid2, local, src/mid2.tsx, 1 step",
      "mid1, local, src/mid1.tsx, 1 step",
      "far, local, src/far.tsx, 2 steps",
      "further, local, src/further.tsx, 3 steps",
    ]);
    expect(screen.getByRole("heading", { name: "Rendered by" }).closest("header")).toHaveTextContent(
      "Rendered by4",
    );
  });

  it("empty lists say so in the same plain words as the caption", () => {
    // F is a true leaf in both directions: nothing renders it and it renders
    // nothing, like an unused design-system component.
    const loneGraph: CompositionGraph = { nodes: [node("F")], edges: [] };
    render(<CompositionTab detail={detail} graph={loneGraph} />);
    expect(screen.getByText("Nothing in this repo renders F.")).toBeInTheDocument();
    expect(screen.getByText("F renders no other components in this repo.")).toBeInTheDocument();
  });

  // The collapsed strip counts the same two lists, and an empty downward list
  // reads as words, never as a bare "renders 0".
  it("the collapsed strip says 'renders nothing' when the downward list is empty", () => {
    const loneGraph: CompositionGraph = {
      nodes: [node("root0"), node("F")],
      edges: [{ source: "root0", target: "F", count: 1 }],
    };
    render(<CompositionTab detail={detail} graph={loneGraph} />);
    fireEvent.click(screen.getByRole("button", { name: /hide lists/i }));
    expect(screen.getByText("1 depends on it · renders nothing")).toBeInTheDocument();
    // rail-collapse.ts persists the preference to localStorage, so reopen the
    // rail before the next test.
    fireEvent.click(screen.getByRole("button", { name: /show lists/i }));
  });
});

describe("expansion, filter, focus", () => {
  it("Show more ⇄ Show fewer on one persistent button that keeps focus", () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    const toggle = screen.getByRole("button", { name: "Show 2 more" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show fewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getByRole("button", { name: "Show 2 more" })).toBeInTheDocument();
  });

  it("filter appears only when expanded, narrows rows, and reports N of M", () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    const input = screen.getByRole("searchbox", { name: "Filter Rendered by" });
    fireEvent.change(input, { target: { value: "root7" } });
    expect(screen.getByText("root7")).toBeInTheDocument();
    expect(screen.queryByText("root0")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 8")).toBeInTheDocument();
    // packageName-only match: "acme" isn't in root6's displayName or filePath.
    fireEvent.change(input, { target: { value: "acme" } });
    expect(screen.getByText("root6")).toBeInTheDocument();
    expect(screen.queryByText("root7")).not.toBeInTheDocument();
    expect(screen.queryByText("root0")).not.toBeInTheDocument();
    // filePath-only match: "src/root5" isn't in root5's displayName or packageName.
    fireEvent.change(input, { target: { value: "src/root5" } });
    expect(screen.getByText("root5")).toBeInTheDocument();
    expect(screen.queryByText("root6")).not.toBeInTheDocument();
    expect(screen.queryByText("root0")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });
});

describe("degenerate state", () => {
  it("says there is no render tree, and claims nothing about the lists", async () => {
    render(<CompositionTab detail={{ ...detail, componentId: "ghost" } as ComponentDetail} graph={graph} />);
    expect(screen.getByText("No render tree for F.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rendered by" })).not.toBeInTheDocument();
    // The canvas loads lazily: let it arrive before checking it never rendered.
    await act(async () => {});
    expect(screen.queryByTestId("canvas-stub")).not.toBeInTheDocument();
  });
});

describe("styling and scroll behavior", () => {
  it("panel sections are bounded flex columns so their own list can scroll", () => {
    const { container } = render(<CompositionTab detail={detail} graph={graph} />);
    const sections = container.querySelectorAll("section.panel");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    for (const s of sections) {
      expect(s.className).toContain("lg:flex-col");
      // shrink floor: a panel may shrink so its list scrolls, never below 10rem
      expect(s.className).toContain("lg:min-h-40");
    }
  });
});

describe("rail collapse", () => {
  it("renders the rail open by default with a control to hide it", () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    expect(screen.getByRole("button", { name: /hide lists/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rendered by/i })).toBeInTheDocument();
  });

  it("collapses to a strip that still names the counts, and restores", () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: /hide lists/i }));

    // The strip still names both counts: 8 above and 1 below, the numbers the
    // open panels carry.
    expect(screen.queryByRole("heading", { name: /rendered by/i })).not.toBeInTheDocument();
    const show = screen.getByRole("button", { name: /show lists/i });
    expect(show).toBeInTheDocument();
    expect(screen.getByText("8 depend on it · renders 1")).toBeInTheDocument();

    fireEvent.click(show);
    expect(screen.getByRole("heading", { name: /rendered by/i })).toBeInTheDocument();
  });

  it("singularizes the dependent count in the collapsed strip", () => {
    const soloGraph: CompositionGraph = {
      nodes: [node("root0"), node("F"), node("ext", { scope: "external", packageName: "@ui/lib", filePath: null })],
      edges: [
        { source: "root0", target: "F", count: 1 },
        { source: "F", target: "ext", count: 2 },
      ],
    };
    render(<CompositionTab detail={detail} graph={soloGraph} />);
    fireEvent.click(screen.getByRole("button", { name: /hide lists/i }));
    expect(screen.getByText("1 depends on it · renders 1")).toBeInTheDocument();
    // rail-collapse.ts persists the preference to localStorage, so reopen the
    // rail before the next test.
    fireEvent.click(screen.getByRole("button", { name: /show lists/i }));
  });
});

describe("rail scroll structure", () => {
  // The rail itself never scrolls: each panel's list is that panel's one
  // scroll region, with the header, filter and pager pinned around it. The
  // "Hide lists" button sits outside every scroll region, so it stays visible
  // at any scroll position.
  it("the only scroll regions are the per-panel lists, before and after expanding", () => {
    const { container } = render(<CompositionTab detail={detail} graph={graph} />);
    const scrollers = () => [...container.querySelectorAll('[class*="overflow-y-auto"]')];
    expect(scrollers().every((e) => e.tagName === "UL")).toBe(true);
    expect(scrollers()).toHaveLength(2); // both panels have rows in this fixture
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
    expect(scrollers()).toHaveLength(2);
    expect(scrollers().every((e) => e.tagName === "UL")).toBe(true);
  });

  it("the collapse button is not a descendant of any scroll region", () => {
    const { container } = render(<CompositionTab detail={detail} graph={graph} />);
    const button = screen.getByRole("button", { name: /hide lists/i });
    const scrollers = [...container.querySelectorAll('[class*="overflow-y-auto"]')];
    expect(scrollers.length).toBeGreaterThan(0);
    for (const s of scrollers) expect(s.contains(button)).toBe(false);
  });
});

describe("long-content handling", () => {
  // Two rows that differ only in a middle path segment (two Next.js
  // `loading.tsx` route files) show the tails that tell them apart, through
  // the same distinctTails() the canvas uses for chip tooltips.
  it("a rail row's path shows the informative tail, not an identical shared prefix", () => {
    const longRoots = [
      node("longA", {
        occurrenceCount: 2,
        filePath: "apps/web/app/(use-page-wrapper)/availability/[schedule]/loading.tsx",
      }),
      node("longB", {
        occurrenceCount: 1,
        filePath: "apps/web/app/(use-page-wrapper)/event-types/[type]/loading.tsx",
      }),
    ];
    const longGraph: CompositionGraph = {
      nodes: [...longRoots, node("F")],
      edges: longRoots.map((r) => ({ source: r.id, target: "F", count: 1 })),
    };
    render(<CompositionTab detail={detail} graph={longGraph} />);
    expect(screen.getByText("…/[schedule]/loading.tsx")).toBeInTheDocument();
    expect(screen.getByText("…/[type]/loading.tsx")).toBeInTheDocument();
    expect(screen.queryByText(longRoots[0]!.filePath as string)).not.toBeInTheDocument();
    // The visible text is shortened, but the row's aria-label carries the full
    // path. `getByRole`'s `name` matches a plain string exactly, so a function
    // matcher asserts "contains".
    expect(
      screen.getByRole("button", { name: (n) => n.includes(longRoots[0]!.filePath as string) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: (n) => n.includes(longRoots[1]!.filePath as string) }),
    ).toBeInTheDocument();
  });

  // distinctTails runs over the panel's complete row set, not the filtered or
  // paged slice, so a row left as the only match keeps its longer label.
  it("a rail row's label survives filtering: computed over the full row set, not the visible slice", () => {
    const longRoots = [
      node("longA", {
        occurrenceCount: 3,
        filePath: "apps/web/app/(use-page-wrapper)/video/meeting-not-started/[uid]/page.tsx",
      }),
      node("longB", {
        occurrenceCount: 2,
        filePath: "apps/web/app/(use-page-wrapper)/video/meeting-ended/[uid]/page.tsx",
      }),
      node("longC", {
        occurrenceCount: 1,
        filePath: "apps/web/app/(use-page-wrapper)/video/[uid]/page.tsx",
      }),
    ];
    // Filler rows push the panel past PANEL_PAGE(6) so the filter box is
    // reachable; their own (default) paths are already unique at two segments
    // and never collide with the video fixture above.
    const filler = Array.from({ length: 4 }, (_, i) => node(`filler${i}`, { occurrenceCount: 10 + i }));
    const manyRoots = [...filler, ...longRoots];
    const manyGraph: CompositionGraph = {
      nodes: [...manyRoots, node("F")],
      edges: manyRoots.map((r) => ({ source: r.id, target: "F", count: 1 })),
    };
    render(<CompositionTab detail={detail} graph={manyGraph} />);

    fireEvent.click(screen.getByRole("button", { name: /show \d+ more/i }));
    expect(screen.getByText("…/meeting-not-started/[uid]/page.tsx")).toBeInTheDocument();

    const input = screen.getByRole("searchbox", { name: "Filter Rendered by" });
    fireEvent.change(input, { target: { value: "not-started" } });
    expect(screen.getByText("longA")).toBeInTheDocument();
    expect(screen.queryByText("longB")).not.toBeInTheDocument();
    // longA is the only row shown, and its label is unchanged from the
    // unfiltered render, not shrunk back to the ambiguous shared tail.
    expect(screen.getByText("…/meeting-not-started/[uid]/page.tsx")).toBeInTheDocument();
    expect(screen.queryByText("…/[uid]/page.tsx")).not.toBeInTheDocument();
  });
});
