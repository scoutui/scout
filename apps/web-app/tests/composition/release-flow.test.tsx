// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentDetail, CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CompositionTab } from "@/components/component-detail/composition/composition-tab";

// The pin round-trips through `?pin=`. The mock re-renders on every
// history.replaceState, as Next.js does, so the synchronous aria-pressed
// assertions see a commit or Escape on the next render.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

beforeEach(() => {
  window.history.replaceState(null, "", "http://localhost:3000/");
});

const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id, displayName: id, packageName: null, filePath: `src/${id}.tsx`,
  scope: "local", deprecated: false, occurrenceCount: 1, ...o,
});
const detail = {
  componentId: "F", repoId: "r/x", scope: "local", displayName: "F",
  composition: { renders: [], renderedBy: [], isRootCount: 0, isLeafCount: 0 },
} as unknown as ComponentDetail;
const graph: CompositionGraph = {
  nodes: [node("root0"), node("F")],
  edges: [{ source: "root0", target: "F", count: 1 }],
};
const renderTab = () =>
  render(
    <ThemeProvider>
      <CompositionTab detail={detail} graph={graph} />
    </ThemeProvider>,
  );

describe("pinned release affordances", () => {
  it("commit shows the header release chip and the live announcement", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /root0.*1 step/ }));
    expect(await screen.findByRole("button", { name: "Clear this path (Escape)" })).toBeInTheDocument();
    expect(screen.getByText(/Showing the path to root0/)).toBeInTheDocument();
  });

  it("Escape releases the pin", async () => {
    renderTab();
    const row = await screen.findByRole("button", { name: /root0.*1 step/ });
    fireEvent.click(row);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Clear this path (Escape)" })).not.toBeInTheDocument();
    expect(screen.getByText("Path cleared")).toBeInTheDocument();
  });

  it("the header release chip releases on click", async () => {
    renderTab();
    const row = await screen.findByRole("button", { name: /root0.*1 step/ });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Clear this path (Escape)" }));
    expect(row).toHaveAttribute("aria-pressed", "false");
  });
});

describe("rail/caption reconciliation on a cyclic upward graph", () => {
  // F's only direct owner is Z; Z and W cycle above it with no true root
  // anywhere upward. The closure walk must terminate and count both (Z at 1
  // step, W at 2), and the caption's "in total" matches the rail because both
  // read `closureOf`.
  const cyclicGraph: CompositionGraph = {
    nodes: [node("F"), node("Z"), node("W")],
    edges: [
      { source: "Z", target: "F", count: 1 },
      { source: "W", target: "Z", count: 1 },
      { source: "Z", target: "W", count: 1 },
    ],
  };

  it("the rail lists the whole upward cycle and the caption quotes the same total", async () => {
    render(
      <ThemeProvider>
        <CompositionTab detail={detail} graph={cyclicGraph} />
      </ThemeProvider>,
    );
    expect(await screen.findByRole("button", { name: /^Z, local, src\/Z.tsx, 1 step$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^W, local, src\/W.tsx, 2 steps$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rendered by" }).closest("header")).toHaveTextContent(
      "Rendered by2",
    );
    expect((await screen.findByRole("heading", { name: "Render tree" })).nextElementSibling).toHaveTextContent(
      "1 component renders F directly; 2 depend on it in total. F renders no other components in this repo.",
    );
  });

  // A component in both lists reads as pinned only in the list that was
  // clicked: the pin carries its direction. The toggle-off also matches on id
  // and direction, so clicking the other list's row switches the pin rather
  // than releasing it.
  it("pins per direction when a component sits in both lists, and switches rather than releasing", async () => {
    const bothWays: CompositionGraph = {
      nodes: [node("F"), node("Z")],
      edges: [
        { source: "Z", target: "F", count: 1 },
        { source: "F", target: "Z", count: 1 },
      ],
    };
    render(
      <ThemeProvider>
        <CompositionTab detail={detail} graph={bothWays} />
      </ThemeProvider>,
    );
    // Rail order is "Rendered by" then "Renders", so rows[0] is the upward Z.
    const rows = await screen.findAllByRole("button", { name: /^Z, local/ });
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[0] as HTMLElement);
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");
    expect(rows[1]).toHaveAttribute("aria-pressed", "false");
    expect(new URLSearchParams(window.location.search).get("pin")).toBe("up:Z");

    fireEvent.click(rows[1] as HTMLElement);
    expect(rows[0]).toHaveAttribute("aria-pressed", "false");
    expect(rows[1]).toHaveAttribute("aria-pressed", "true");
    expect(new URLSearchParams(window.location.search).get("pin")).toBe("down:Z");

    // Clicking the same row twice still releases.
    fireEvent.click(rows[1] as HTMLElement);
    expect(rows[1]).toHaveAttribute("aria-pressed", "false");
    expect(new URLSearchParams(window.location.search).has("pin")).toBe(false);
  });
});
