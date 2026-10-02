// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentDetail, CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CompositionTab } from "@/components/component-detail/composition/composition-tab";

// CompositionTab's pin round-trips through useSearchParams, which needs an
// app-router context that a bare jsdom render lacks.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

// On the real canvas, a hover-highlight change must (1) not remount any
// `.react-flow__node` and (2) change the class list of only the chips whose
// highlight flipped. It cannot catch a wasted re-render that produces
// identical output: a `hoverPath` dep on the `computeLayout` memo, or an
// `activeHighlight` dep on the `flowNodes` memo, both pass.

const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id,
  displayName: id,
  packageName: null,
  filePath: `src/${id}.tsx`,
  scope: "local",
  deprecated: false,
  occurrenceCount: 1,
  ...o,
});

// Focus F with three owners (o0..o2), well under COLUMN_CAP: every owner
// renders as its own chip, so the highlight set maps 1:1 onto chip ids.
const owners = Array.from({ length: 3 }, (_, i) => node(`o${i}`, { occurrenceCount: 3 - i }));
const detail = {
  componentId: "F",
  repoId: "r/x",
  scope: "local",
  displayName: "F",
  composition: {
    renders: [],
    renderedBy: owners.map((o) => ({
      componentId: o.id,
      displayName: o.id,
      packageName: null,
      scope: "local",
      count: 1,
    })),
    isRootCount: 0,
    isLeafCount: 0,
  },
} as unknown as ComponentDetail;
const graph: CompositionGraph = {
  nodes: [...owners, node("F")],
  edges: owners.map((o) => ({ source: o.id, target: "F", count: 1 })),
};

/** The chip's styled wrapper (the react-flow__node's first child div), where
 *  `opacity-30` lands. */
function chipWrapper(flowNode: Element): Element {
  const wrapper = flowNode.querySelector(":scope > div");
  if (!wrapper) throw new Error("chip wrapper not found");
  return wrapper;
}

function snapshotFlowNodes(): Map<string, { el: Element; outerHTML: string }> {
  const snapshot = new Map<string, { el: Element; outerHTML: string }>();
  for (const el of document.querySelectorAll(".react-flow__node")) {
    const id = el.getAttribute("data-id");
    if (!id) continue;
    snapshot.set(id, { el, outerHTML: chipWrapper(el).outerHTML });
  }
  return snapshot;
}

describe("node stability under hover-highlight changes", () => {
  it("a rail-row hover dims only off-chain chips; the focus chip and on-chain chip stay undimmed", async () => {
    render(
      <ThemeProvider>
        <CompositionTab detail={detail} graph={graph} />
      </ThemeProvider>,
    );
    const row = await screen.findByRole("button", { name: /o0.*1 step/ });
    // The canvas loads lazily; wait for it to draw the four chips.
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node")).toHaveLength(4));
    fireEvent.mouseEnter(row);

    const nodes = document.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBe(4); // F, o0, o1, o2

    for (const el of nodes) {
      const id = el.getAttribute("data-id");
      const dimmed = chipWrapper(el).className.includes("opacity-30");
      // On the F->o0 path: F (focus, never dims) and o0 (on-chain) stay lit;
      // o1 and o2 are off-chain and must dim.
      if (id === "F" || id === "o0") expect(dimmed).toBe(false);
      else expect(dimmed).toBe(true);
    }
  });

  it("a second, different rail-row hover flips only the two affected chips and remounts nothing", async () => {
    render(
      <ThemeProvider>
        <CompositionTab detail={detail} graph={graph} />
      </ThemeProvider>,
    );
    const rowO0 = await screen.findByRole("button", { name: /o0.*1 step/ });
    // The canvas loads lazily; wait for it to draw the four chips.
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node")).toHaveLength(4));
    const rowO1 = screen.getByRole("button", { name: /o1.*1 step/ });

    fireEvent.mouseEnter(rowO0);
    const before = snapshotFlowNodes();
    expect(before.size).toBe(4);

    fireEvent.mouseEnter(rowO1);
    const after = snapshotFlowNodes();

    // (1) No remount: every id keeps the same DOM element. A rebuilt
    // `flowNodes` array would surface as react-flow re-creating node elements.
    for (const [id, snap] of before) {
      const nowEl = after.get(id)?.el;
      expect(nowEl).toBe(snap.el);
    }

    // (2) Only o0 (chain -> dim) and o1 (dim -> chain) changed their rendered
    // class list. F (never dims) and o2 (dim throughout) are byte-identical.
    for (const [id, snap] of before) {
      const nowHtml = after.get(id)?.outerHTML;
      if (id === "o0" || id === "o1") {
        expect(nowHtml).not.toBe(snap.outerHTML);
      } else {
        expect(nowHtml).toBe(snap.outerHTML);
      }
    }

    // The flip went the expected way, not just "changed".
    expect(chipWrapper(after.get("o0")?.el as Element).className).toContain("opacity-30");
    expect(chipWrapper(after.get("o1")?.el as Element).className).not.toContain("opacity-30");
    expect(chipWrapper(after.get("o2")?.el as Element).className).toContain("opacity-30");
    expect(chipWrapper(after.get("F")?.el as Element).className).not.toContain("opacity-30");
  });
});
