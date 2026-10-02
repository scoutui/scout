// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentDetail, CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import { CompositionTab } from "@/components/component-detail/composition/composition-tab";

// The pin round-trips through `?pin=`; the mock re-renders on a history write,
// as Next.js does.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

vi.mock("@/components/component-detail/composition/composition-canvas", () => ({
  CompositionCanvas: (props: { pinned: unknown; hoverPath: unknown; onRelease: () => void }) => (
    <div
      data-testid="canvas-stub"
      data-pinned={JSON.stringify(props.pinned)}
      data-hover-path={JSON.stringify(props.hoverPath)}
    >
      <button type="button" onClick={props.onRelease}>
        release
      </button>
    </div>
  ),
}));

// jsdom keeps the URL between tests, so a pin written by one test would leak
// into the next.
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
const roots = [node("root0", { occurrenceCount: 2 }), node("root1")];
const graph: CompositionGraph = {
  nodes: [...roots, node("F"), node("ext", { scope: "external", packageName: "@ui/lib", filePath: null })],
  edges: [
    ...roots.map(r => ({ source: r.id, target: "F", count: 1 })),
    { source: "F", target: "ext", count: 2 },
  ],
};
const pinnedOf = () => JSON.parse(screen.getByTestId("canvas-stub").getAttribute("data-pinned") ?? "null");
// The canvas loads lazily: wait for it so every test starts from a drawn tab.
const renderTab = async () => {
  const view = render(<CompositionTab detail={detail} graph={graph} />);
  await screen.findByTestId("canvas-stub");
  return view;
};
const renderTabAt = (search: string) => {
  window.history.replaceState(null, "", `http://localhost:3000/${search}`);
  return renderTab();
};

describe("the pin round-trips through ?pin=", () => {
  it("restores a pinned path from the URL on mount", async () => {
    await renderTabAt("?pin=up:root0");
    const row = screen.getByRole("button", { name: /root0/ });
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(pinnedOf()).toEqual([{ id: "F", level: 0 }, { id: "root0", level: -1 }]);
  });

  it("writes the pin to the URL when a row commits, and clears it on release", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: /root0/ }));
    expect(new URLSearchParams(window.location.search).get("pin")).toBe("up:root0");
    fireEvent.click(screen.getByRole("button", { name: "release" }));
    expect(new URLSearchParams(window.location.search).has("pin")).toBe(false);
  });

  it("clicking the same row again also clears the URL param (the existing toggle-off gesture)", async () => {
    await renderTab();
    const row = screen.getByRole("button", { name: /root0/ });
    fireEvent.click(row);
    expect(new URLSearchParams(window.location.search).get("pin")).toBe("up:root0");
    fireEvent.click(row);
    expect(new URLSearchParams(window.location.search).has("pin")).toBe(false);
  });

  it("preserves unrelated existing search params on write", async () => {
    await renderTabAt("?tab=composition&scan=abc123");
    fireEvent.click(screen.getByRole("button", { name: /root0/ }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("composition");
    expect(params.get("scan")).toBe("abc123");
    expect(params.get("pin")).toBe("up:root0");
  });

  // The pin encodes no repoId: the graph is already scoped to one repo, so an
  // id from another repo's graph is the same case as an id this graph never had.
  it("an unresolvable pin (stale link, id no longer in the graph) degrades silently to the unpinned view", async () => {
    await renderTabAt("?pin=up:does-not-exist");
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
    expect(pinnedOf()).toBeNull();
    // No rail row reads as pinned.
    expect(screen.getByRole("button", { name: /root0/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /root1/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("a malformed pin value (no direction prefix) parses to unpinned rather than throwing", async () => {
    await renderTabAt("?pin=root0");
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
    expect(pinnedOf()).toBeNull();
  });
});

describe("rail rows commit on click", () => {
  it("click pins the min-hop path, marks the row pressed; same-row click releases", async () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    const row = screen.getByRole("button", { name: /root0/ });
    expect(row).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(pinnedOf()).toEqual([{ id: "F", level: 0 }, { id: "root0", level: -1 }]);
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(pinnedOf()).toBeNull();
  });

  it("clicking a different row switches the pin", async () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: /root0/ }));
    fireEvent.click(screen.getByRole("button", { name: /root1/ }));
    expect(pinnedOf()).toEqual([{ id: "F", level: 0 }, { id: "root1", level: -1 }]);
    expect(screen.getByRole("button", { name: /root0/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("row hover feeds hoverPath without pinning; leave clears it", async () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    const row = screen.getByRole("button", { name: /root0/ });
    fireEvent.mouseEnter(row);
    expect(JSON.parse(screen.getByTestId("canvas-stub").getAttribute("data-hover-path") ?? "null"))
      .toEqual(["F", "root0"]);
    expect(pinnedOf()).toBeNull();
    fireEvent.mouseLeave(row);
    expect(screen.getByTestId("canvas-stub").getAttribute("data-hover-path")).toBe("null");
  });

  it("a downward endpoint row pins with positive levels", async () => {
    render(<CompositionTab detail={detail} graph={graph} />);
    fireEvent.click(screen.getByRole("button", { name: /ext/ }));
    expect(pinnedOf()).toEqual([{ id: "F", level: 0 }, { id: "ext", level: 1 }]);
  });
});
