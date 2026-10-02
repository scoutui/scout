// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  HighlightStore, useNodeHighlight, useHighlightSet,
} from "@/components/component-detail/composition/use-highlight";

function Probe({ store, id, spy, neverDims }: {
  store: HighlightStore; id: string; spy: () => void; neverDims?: boolean;
}) {
  spy();
  const h = useNodeHighlight(store, id, neverDims);
  return <span data-testid={`probe-${id}`}>{h}</span>;
}

describe("HighlightStore precedence", () => {
  it("override beats base and reverts on clear", () => {
    const store = new HighlightStore();
    store.setBase(new Set(["a"]));
    expect(store.getActive()).toEqual(new Set(["a"]));
    store.setOverride(new Set(["b"]));
    expect(store.getActive()).toEqual(new Set(["b"]));
    store.setOverride(null);
    expect(store.getActive()).toEqual(new Set(["a"]));
    store.setBase(null);
    expect(store.getActive()).toBeNull();
  });
});

describe("useNodeHighlight", () => {
  it("re-renders only nodes whose value flips (the flicker invariant)", () => {
    const store = new HighlightStore();
    const spyA = vi.fn();
    const spyB = vi.fn();
    render(
      <>
        <Probe store={store} id="a" spy={spyA} />
        <Probe store={store} id="b" spy={spyB} />
      </>,
    );
    act(() => store.setOverride(new Set(["a", "b"])));
    // none → chain for both
    expect(screen.getByTestId("probe-a").textContent).toBe("chain");
    expect(screen.getByTestId("probe-b").textContent).toBe("chain");
    const a = spyA.mock.calls.length;
    const b = spyB.mock.calls.length;
    act(() => store.setOverride(new Set(["a"])));
    // a stays "chain" (no re-render); b flips chain → dim (one re-render)
    expect(spyA.mock.calls.length).toBe(a);
    expect(spyB.mock.calls.length).toBe(b + 1);
    expect(screen.getByTestId("probe-b").textContent).toBe("dim");
  });

  it("neverDims pins a node to chain while a highlight is active", () => {
    const store = new HighlightStore();
    render(<Probe store={store} id="focus" spy={() => {}} neverDims />);
    expect(screen.getByTestId("probe-focus").textContent).toBe("none");
    act(() => store.setOverride(new Set(["other"])));
    expect(screen.getByTestId("probe-focus").textContent).toBe("chain");
  });
});

describe("useHighlightSet", () => {
  function SetProbe({ store }: { store: HighlightStore }) {
    const set = useHighlightSet(store);
    return <span data-testid="set">{set ? [...set].sort().join(",") : "null"}</span>;
  }
  it("tracks the active set", () => {
    const store = new HighlightStore();
    render(<SetProbe store={store} />);
    expect(screen.getByTestId("set").textContent).toBe("null");
    act(() => store.setBase(new Set(["x", "y"])));
    expect(screen.getByTestId("set").textContent).toBe("x,y");
  });
});
