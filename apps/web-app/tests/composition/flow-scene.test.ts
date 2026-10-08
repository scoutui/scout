import { describe, it, expect } from "vitest";
import { bothRoutes, findRows, type Dir, type GraphModel } from "@/components/component-detail/composition/graph-model";
import {
  buildScene,
  FOCUS_CAP,
  OPEN_CAP,
  type ChipItem,
  type GroupItem,
  type Scene,
  type SceneState,
} from "@/components/component-detail/composition/flow-scene";
import {
  downwardFixture, dualRouteFixture, flatFixture, graph, model, node, structuredFixture, tinyFixture,
} from "./graph-fixtures";

const empty: SceneState = { lists: new Set(), brought: new Set(), pin: null };

const scene = (m: GraphModel, state: Partial<SceneState> = {}) =>
  buildScene(m, "F", bothRoutes(m, "F"), { ...empty, ...state });
const up = (...ids: string[]) => ({ pin: { dir: "up" as Dir, ids } });

const chips = (s: ReturnType<typeof scene>) => s.items.filter((i): i is ChipItem => i.kind === "chip");
const groups = (s: ReturnType<typeof scene>) =>
  s.items.filter((i): i is GroupItem => i.kind === "more" || i.kind === "list");

/** F rendered directly by `n` components, d0 using it most. */
const directlyGraph = (n: number) =>
  graph(
    [node("F"), ...Array.from({ length: n }, (_, i) => node(`d${i}`))],
    Array.from({ length: n }, (_, i) => [`d${i}`, "F", n - i] as [string, string, number]),
  );
const directly = (n: number) => model(directlyGraph(n));

describe("buildScene", () => {
  it("opens everything that renders the selected box, components drawn nearer included", () => {
    // r0..r2 render F directly and through P; the rest only through P.
    const m = model(dualRouteFixture().graph);
    const s = scene(m, up("P"));
    expect(chips(s).map((c) => [c.node.id, c.steps])).toEqual([
      ["r0", 2], ["r1", 2], ["r2", 2], ["r3", 2], ["r4", 2],
      ["P", 1], ["r0", 1], ["r1", 1], ["r2", 1],
      ["F", 0],
    ]);
    expect(groups(s).map((g) => [g.steps, g.members.map((mb) => mb.node.id)])).toEqual([[2, ["r5", "r6"]]]);
  });

  it.each([
    ["a box nearer the focus", model(dualRouteFixture().graph), ["P"], ["r0", "r1", "r2"]],
    ["a +N more nearer the focus", model(graph([...directlyGraph(FOCUS_CAP + 3).nodes], [...directlyGraph(FOCUS_CAP + 3).edges.map((e) => [e.source, e.target, e.count] as [string, string, number]), [`d${FOCUS_CAP + 2}`, "d0", 1]])), ["d0"], [`d${FOCUS_CAP + 2}`]],
  ] as const)("marks a box as a repeat when its component also appears in %s", (_, m, ids, repeats) => {
    const s = scene(m, up(...ids));
    expect(chips(s).filter((c) => c.repeat).map((c) => [c.node.id, c.steps])).toEqual(repeats.map((id) => [id, 2]));
  });

  it("follows a route through a repeat, a column for each step", () => {
    // A, B and C each render F; B renders A, C renders B, and D renders C.
    const m = model(graph(["F", "A", "B", "C", "D"].map((id) => node(id)), [["A", "F"], ["B", "F"], ["C", "F"], ["B", "A"], ["C", "B"], ["D", "C"]]));
    const s = scene(m, up("A", "B", "C"));
    expect(chips(s).map((c) => [c.node.id, c.steps, c.repeat])).toEqual([
      ["D", 4, false], ["C", 3, true], ["B", 2, true], ["A", 1, false], ["F", 0, false],
    ]);
    expect([...s.pathIds].sort()).toEqual(["focus", "up:A", "up:A,B", "up:A,B,C"]);
  });

  it("closes a loop: a component already on the route, or the focus, shows behind the selected box as a box that can't open", () => {
    // X renders F, Y renders X; X and F each render Y.
    const m = model(graph(["F", "X", "Y"].map((id) => node(id)), [["X", "F"], ["Y", "X"], ["X", "Y"], ["F", "Y"]]));
    const s = scene(m, up("X", "Y"));
    expect(chips(s).map((c) => [c.node.id, c.steps, c.loop])).toEqual([
      ["F", 3, true], ["X", 3, true], ["Y", 2, false], ["X", 1, false], ["F", 0, false],
    ]);
    expect(s.edges.map((e) => e.id)).toContain("up:X,Y,X>up:X,Y");
    expect(chips(scene(m, up("X"))).some((c) => c.loop)).toBe(false);
  });

  it("labels a line on the selected route with its uses when a component renders the next more than once", () => {
    // A renders F 3 times; B renders A once.
    const m = model(graph(["F", "A", "B"].map((id) => node(id)), [["A", "F", 3], ["B", "A", 1]]));
    const weights = (s: Scene) => Object.fromEntries(s.edges.map((e) => [e.id, e.weight]));
    expect(weights(scene(m, up("A", "B")))).toEqual({ "up:A,B>up:A": null, "up:A>focus": "×3" });
    expect(weights(scene(m))).toEqual({ "up:A>focus": null });
  });

  it.each([
    ["one past the cap shows every component", FOCUS_CAP + 1, FOCUS_CAP + 1, 0],
    ["two past the cap folds the rest into +N more", FOCUS_CAP + 2, FOCUS_CAP, 2],
  ])("%s", (_, n, shown, hidden) => {
    const s = scene(directly(n));
    expect(chips(s).filter((c) => c.dir === "up")).toHaveLength(shown);
    expect(groups(s).flatMap((g) => g.members)).toHaveLength(hidden);
  });

  it("gives a +N more line the uses of all its members", () => {
    const s = scene(directly(FOCUS_CAP + 3));
    const group = groups(s)[0] as GroupItem;
    const edge = s.edges.find((e) => e.source === group.id);
    expect(group.members.map((m) => m.uses)).toEqual([3, 2, 1]);
    expect(edge?.count).toBe(6);
  });

  it("opens the next column for the selected box, and only for it", () => {
    const m = model(dualRouteFixture().graph);
    expect(chips(scene(m)).some((c) => c.steps === 2)).toBe(false);
    expect(chips(scene(m, up("P"))).filter((c) => c.steps === 2)).toHaveLength(OPEN_CAP);
    expect(chips(scene(m, up("r0"))).some((c) => c.steps === 2)).toBe(false);
  });

  it("folds the focus's column to the route and collapses the other side once a route is two steps or more", () => {
    // F renders kid; r3 reaches F only through P.
    const g = dualRouteFixture().graph;
    const m = model(graph([...g.nodes, node("kid")], [...g.edges.map((e) => [e.source, e.target, e.count] as [string, string, number]), ["F", "kid", 1]]));
    const s = scene(m, up("P", "r3"));
    expect(chips(s).map((c) => c.node.id)).toEqual(["r3", "P", "F"]);
    expect(s.items.find((i) => i.kind === "summary")).toMatchObject({ dir: "down", direct: 1, total: 1 });
    expect([...s.pathIds].sort()).toEqual(["focus", "up:P", "up:P,r3"]);
  });

  it("keeps the other side when the route is one step", () => {
    const g = tinyFixture().graph;
    const m = model(graph([...g.nodes, node("kid")], [["r0", "F", 1], ["r1", "F", 2], ["r2", "F", 1], ["F", "kid", 1]]));
    const s = scene(m, up("r0"));
    expect(s.items.some((i) => i.kind === "summary")).toBe(false);
    expect(chips(s).map((c) => c.node.id)).toEqual(["r1", "r0", "r2", "F", "kid"]);
  });

  it("brings a component out of its +N more into the column", () => {
    const m = directly(FOCUS_CAP + 3);
    const s = scene(m, { brought: new Set([`up:d${FOCUS_CAP + 2}`]) });
    expect(chips(s).some((c) => c.node.id === `d${FOCUS_CAP + 2}`)).toBe(true);
    expect(groups(s)[0]?.members.map((mb) => mb.node.id)).toEqual([`d${FOCUS_CAP}`, `d${FOCUS_CAP + 1}`]);
  });

  it("names each line in words: who renders whom, and how many times", () => {
    const m = directly(FOCUS_CAP + 3);
    const labels = scene(m).edges.map((e) => e.label);
    expect(labels).toContain("d0 renders F 13 times");
    expect(labels).toContain("3 more components render F");
    const down = model(graph([node("F"), node("kid")], [["F", "kid", 1]]));
    expect(scene(down).edges.map((e) => e.label)).toEqual(["F renders kid once"]);
  });

  it.each([
    ["every box drawn", model(tinyFixture().graph), {}, ["Directly"]],
    ["some folded into +N more", directly(FOCUS_CAP + 3), {}, [`Directly · ${FOCUS_CAP + 3}`]],
    ["the selected box's column", model(dualRouteFixture().graph), up("P"), ["Directly", "2 steps away · 7"]],
    ["columns folded to the route", model(dualRouteFixture().graph), up("P", "r3"), ["Directly", "2 steps away"]],
  ] as const)("heads a column with its steps, and with its count only when +N more hides some of it: %s", (_, m, state, texts) => {
    expect(scene(m, state).headings.map((h) => h.text)).toEqual(texts);
  });

  // F and d0 are both called PaymentCard; d0 renders F.
  const namesake = (focusName: string) =>
    model(graph([node("F", { displayName: focusName, filePath: "src/ui/PaymentCard.tsx" }), node("d0", { displayName: "PaymentCard", filePath: "src/checkout/PaymentCard.tsx" })], [["d0", "F"]]));
  const box = (s: ReturnType<typeof scene>, id: string) => chips(s).find((c) => c.id === id) as ChipItem;

  it("labels a box that shares the focus's name with what tells it apart, but not the focus", () => {
    const s = scene(namesake("PaymentCard"));
    expect([box(s, "focus").fragment, box(s, "up:d0").fragment]).toEqual([null, "checkout"]);
  });

  it("sizes a box for its name and its label", () => {
    expect(box(scene(namesake("PaymentCard")), "up:d0").w).toBeGreaterThan(box(scene(namesake("Other")), "up:d0").w);
  });

  it("widens a box, the focus too, for a name of up to 48 characters", () => {
    const named = (length: number) => scene(model(graph([node("F", { displayName: "F".repeat(length) }), node("d0", { displayName: "D".repeat(length) })], [["d0", "F"]])));
    const [short, long, longest] = [25, 41, 48].map(named) as [Scene, Scene, Scene];
    for (const id of ["focus", "up:d0"]) expect(box(short, id).w < box(long, id).w && box(long, id).w < box(longest, id).w, id).toBe(true);
  });

  // F is rendered directly by d0 and d1, and d0 by p0 and p1 (rendered by,
  // for "down"). Selecting p0 leaves a "+1 more" in each column, both open.
  it.each(["up", "down"] as const)("%s: overlaps nothing with lists open in neighbouring columns", (dir) => {
    const pairs: [string, string][] = [["d0", "F"], ["d1", "F"], ["p0", "d0"], ["p1", "d0"]];
    const m = model(graph(["F", "d0", "d1", "p0", "p1"].map((id) => node(id)), pairs.map(([a, b]) => (dir === "up" ? [a, b] : [b, a]))));
    const s = scene(m, { pin: { dir, ids: ["d0", "p0"] }, lists: new Set([`${dir}:F`, `${dir}:d0`]) });
    expect(groups(s).map((g) => g.kind)).toEqual(["list", "list"]);
    s.items.forEach((a, i) => {
      for (const b of s.items.slice(i + 1)) {
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
    });
  });
});

describe("a selected route", () => {
  const fixtures = { structured: structuredFixture(), flat: flatFixture(), dualRoute: dualRouteFixture(), tiny: tinyFixture(), downward: downwardFixture(), folded: { graph: directlyGraph(FOCUS_CAP + 3), focusId: "F" } };

  it.each(Object.entries(fixtures))("%s: draws every component on it as its own box, joined by lines", (_, fx) => {
    const m = model(fx.graph);
    const routes = bothRoutes(m, fx.focusId);
    for (const dir of ["up", "down"] as const) {
      for (const row of findRows(m, fx.focusId, routes[dir], dir)) {
        const s = buildScene(m, fx.focusId, routes, { ...empty, pin: { dir, ids: row.route } });
        const route = ["focus", ...row.route.map((_, i) => `${dir}:${row.route.slice(0, i + 1).join(",")}`)];
        expect([...s.pathIds].sort(), row.node.id).toEqual([...route].sort());
        for (let i = 0; i < route.length - 1; i++) {
          const [outer, inner] = [route[i], route[i + 1]];
          const joined = s.edges.some((e) => (e.source === outer && e.target === inner) || (e.source === inner && e.target === outer));
          expect(joined, `${row.node.id}: ${outer} to ${inner}`).toBe(true);
        }
      }
    }
  });
});
