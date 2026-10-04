// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CompositionGraphNode } from "@scoutui/web-shared";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { buildGraphModel } from "@/components/component-detail/composition/graph-model";
import { CompositionCanvas } from "@/components/component-detail/composition/composition-canvas";

const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id, displayName: id, packageName: null, filePath: `src/${id}.tsx`,
  scope: "local", deprecated: false, occurrenceCount: 1, ...o,
});

describe("CompositionCanvas smoke", () => {
  it("mounts with legend, skip link, zoom controls and Reset view", async () => {
    const model = buildGraphModel({
      nodes: [node("a"), node("F")],
      edges: [{ source: "a", target: "F", count: 1 }],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={model}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="1 component renders F directly. F renders no other components in this repo."
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    expect(await screen.findByText("rendered by")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip render tree" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
    // Reset view is always in the control cluster, not only once the camera has moved.
    expect(screen.getByRole("button", { name: "Reset view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Render tree" })).toBeInTheDocument();
    // No subtitle above the caption: the header carries only the heading and
    // the one-sentence caption.
    expect(screen.queryByText(/where usage comes from/)).not.toBeInTheDocument();
    // Fixture is a → F: one direct parent, nothing rendered.
    expect(
      screen.getByText(
        "1 component renders F directly. F renders no other components in this repo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("renders directly")).toBeInTheDocument();
    // Every drawn edge is a real render edge, so there is no second edge
    // grammar left to explain.
    expect(
      screen.queryByText("indirect path — components in between aren't drawn"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Render tree graph" })).toBeInTheDocument();
  });

  // jsdom never marks react-flow nodes "measured", so they carry
  // `visibility: hidden` and role queries skip them. A direct DOM query reaches
  // the real control, and the tooltip opens on focus.
  const trigger = (displayId: string, tag: string): HTMLElement => {
    const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${displayId}"] ${tag}`);
    if (!el) throw new Error(`no ${tag} trigger inside node ${displayId}`);
    return el;
  };

  it("a chip's tooltip singularizes a lone use", async () => {
    const model = buildGraphModel({
      nodes: [node("a"), node("F")],
      edges: [{ source: "a", target: "F", count: 1 }],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={model}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="caption"
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    fireEvent.focus(trigger("a", "a"));
    expect(await screen.findByText("1 use")).toBeInTheDocument();
  });

  // Component chips are links, so their tooltip says they open on click.
  it("a link chip's tooltip hints it opens on click", async () => {
    const model = buildGraphModel({
      nodes: [node("a"), node("F")],
      edges: [{ source: "a", target: "F", count: 1 }],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={model}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="caption"
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    fireEvent.focus(trigger("a", "a"));
    expect(await screen.findByText("click to open")).toBeInTheDocument();
  });

  // The focus chip (the component whose page this is) is a plain `<span>` with
  // a null `href`, so its tooltip has no click hint.
  it("the focus chip's tooltip has no click-to-open hint: it has nowhere to navigate", async () => {
    const model = buildGraphModel({
      nodes: [node("a"), node("F")],
      edges: [{ source: "a", target: "F", count: 1 }],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={model}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="caption"
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    fireEvent.focus(trigger("F", "span"));
    // The scope line always renders, so this proves the tooltip opened.
    expect(await screen.findByText("local")).toBeInTheDocument();
    expect(screen.queryByText("click to open")).not.toBeInTheDocument();
  });

  // The "+N more" overflow chip is a plain label: what it stands for is in the
  // rail's list on the left, and its title says so.
  it("the '+N more' overflow chip is a plain label that opens nothing", async () => {
    // 14 distinct-name local owners: COLUMN_CAP (10) folds the last 4 into a
    // "+4 more" overflow chip (MoreNode).
    const owners = Array.from({ length: 14 }, (_, i) => node(`o${i}`, { occurrenceCount: 14 - i }));
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={buildGraphModel({
            nodes: [...owners, node("F")],
            edges: owners.map((o) => ({ source: o.id, target: "F", count: 1 })),
          })}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="caption"
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    const chip = document.querySelector('.react-flow__node[data-id="more:-1"] > div');
    expect(chip?.textContent).toBe("+4 more components");
    expect(chip?.getAttribute("title")).toBe("4 more, listed on the left.");
    // Not a control, and nothing behind it: no button to press, no dialog to
    // open, no focus stop.
    expect(document.querySelector('.react-flow__node[data-id="more:-1"] button')).toBeNull();
    fireEvent.click(chip as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // A chip name that navigates reads as a link before the click; the focus
  // chip's name is not a link.
  it("a link chip's name carries hover-underline + pointer-cursor classes; the focus chip's name carries neither", async () => {
    const model = buildGraphModel({
      nodes: [node("a"), node("F")],
      edges: [{ source: "a", target: "F", count: 1 }],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={model}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="caption"
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    const linkName = trigger("a", "a").querySelector("span.font-mono");
    expect(linkName?.className).toContain("hover:underline");
    expect(linkName?.className).toContain("cursor-pointer");
    const focusName = trigger("F", "span").querySelector("span.font-mono");
    expect(focusName?.className).not.toContain("hover:underline");
    expect(focusName?.className).not.toContain("cursor-pointer");
  });

  it("a deprecated chip shows the warning triangle after its name, which is not struck through", async () => {
    const model = buildGraphModel({
      nodes: [node("a", { deprecated: true }), node("b"), node("F")],
      edges: [
        { source: "a", target: "F", count: 1 },
        { source: "b", target: "F", count: 1 },
      ],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas
          model={model}
          focusId="F"
          repoId="r/x"
          pinned={null}
          hoverPath={null}
          caption="caption"
          onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    const dep = trigger("a", "a");
    const depName = dep.querySelector("span.font-mono");
    expect(depName?.nextElementSibling?.querySelector("svg")).toBeInstanceOf(SVGElement);
    expect(depName?.className).not.toContain("line-through");
    // The non-deprecated chip in the same render has no triangle.
    expect(trigger("b", "a").querySelector("svg")).toBeNull();
  });

  it("two chips with the same name show a distinguishing fragment on their face", async () => {
    const model = buildGraphModel({
      nodes: [
        node("p1", { displayName: "ServerPage", filePath: "app/[type]/page.tsx" }),
        node("p2", { displayName: "ServerPage", filePath: "app/[id]/page.tsx" }),
        node("F"),
      ],
      edges: [
        { source: "p1", target: "F", count: 1 },
        { source: "p2", target: "F", count: 1 },
      ],
    });
    render(
      <ThemeProvider>
        <CompositionCanvas model={model} focusId="F" repoId="r/x" pinned={null} hoverPath={null} onRelease={() => {}} caption="caption" />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    // The fragment is its own span beside the name span, so it survives
    // truncation; the assertions read the trigger's whole text.
    expect(trigger("p1", "a").textContent).toContain("ServerPage");
    expect(trigger("p1", "a").textContent).toContain("[type]");
    expect(trigger("p2", "a").textContent).toContain("ServerPage");
    expect(trigger("p2", "a").textContent).toContain("[id]");
    // The tooltip header keeps the bare name: its body already states scope and
    // path. Scoped to the tooltip's name span, because both chip faces also hold
    // a bare "ServerPage" text node.
    fireEvent.focus(trigger("p1", "a"));
    await screen.findByText("local");
    expect(document.querySelector('[data-slot="tooltip-content"] span.font-mono')?.textContent).toBe(
      "ServerPage",
    );
  });

  const legendOf = (container: HTMLElement) => {
    const footer = container.querySelector("footer");
    if (!footer) throw new Error("no legend");
    return within(footer);
  };

  it("the legend lists only the marks the render tree shows", async () => {
    const { container, unmount } = render(
      <ThemeProvider>
        <CompositionCanvas
          model={buildGraphModel({ nodes: [node("a"), node("F")], edges: [{ source: "a", target: "F", count: 1 }] })}
          focusId="F" repoId="r/x" pinned={null} hoverPath={null} caption="caption" onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("rendered by");
    expect(legendOf(container).getByText("local")).toBeInTheDocument();
    expect(legendOf(container).getByText("renders directly")).toBeInTheDocument();
    expect(legendOf(container).queryByText("external")).not.toBeInTheDocument();
    expect(legendOf(container).queryByText("deprecated")).not.toBeInTheDocument();
    unmount();

    const withMarks = render(
      <ThemeProvider>
        <CompositionCanvas
          model={buildGraphModel({
            nodes: [node("F"), node("ext", { scope: "external", packageName: "@ui/lib", filePath: null, deprecated: true })],
            edges: [{ source: "F", target: "ext", count: 1 }],
          })}
          focusId="F" repoId="r/x" pinned={null} hoverPath={null} caption="caption" onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    await screen.findByText("renders");
    expect(legendOf(withMarks.container).getByText("external")).toBeInTheDocument();
    // The legend's deprecated entry carries the same triangle as the chips.
    expect(legendOf(withMarks.container).getByText("deprecated").querySelector("svg")).toBeInstanceOf(SVGElement);
    withMarks.unmount();

    const lone = render(
      <ThemeProvider>
        <CompositionCanvas
          model={buildGraphModel({ nodes: [node("F")], edges: [] })}
          focusId="F" repoId="r/x" pinned={null} hoverPath={null} caption="caption" onRelease={() => {}}
        />
      </ThemeProvider>,
    );
    expect(await legendOf(lone.container).findByText("local")).toBeInTheDocument();
    expect(legendOf(lone.container).queryByText("renders directly")).not.toBeInTheDocument();
  });

  // Not covered here: the edge tooltips. ReactFlow computes edge paths from
  // measured node sizes, and jsdom reports every node as 0×0, so
  // `.react-flow__edges` stays empty and there is nothing to hover.
});
