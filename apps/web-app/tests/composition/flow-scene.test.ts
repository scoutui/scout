import { describe, it, expect } from "vitest";
import { bothRoutes, findRows, routeIds, type GraphModel } from "@/components/component-detail/composition/graph-model";
import {
  buildScene,
  FOCUS_CAP,
  nothingFurtherOut,
  routeSentence,
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
  it("puts each component once, in the column of its shortest route", () => {
    // r0..r2 render F directly and through P; the rest only through P.
    const m = model(dualRouteFixture().graph);
    const s = scene(m, { pin: { dir: "up", id: "P" } });
    expect(chips(s).map((c) => [c.node.id, c.steps])).toEqual([
      ["r3", 2], ["r4", 2], ["r5", 2], ["r6", 2],
      ["P", 1], ["r0", 1], ["r1", 1], ["r2", 1],
      ["F", 0],
    ]);
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
    expect(chips(scene(m, { pin: { dir: "up", id: "P" } })).filter((c) => c.steps === 2)).toHaveLength(4);
    expect(chips(scene(m, { pin: { dir: "up", id: "r0" } })).some((c) => c.steps === 2)).toBe(false);
  });

  it("folds the focus's column to the route and collapses the other side once a route is two steps or more", () => {
    // F renders kid; r3 reaches F only through P.
    const g = dualRouteFixture().graph;
    const m = model(graph([...g.nodes, node("kid")], [...g.edges.map((e) => [e.source, e.target, e.count] as [string, string, number]), ["F", "kid", 1]]));
    const s = scene(m, { pin: { dir: "up", id: "r3" } });
    expect(chips(s).map((c) => c.node.id)).toEqual(["r3", "P", "F"]);
    expect(s.items.find((i) => i.kind === "summary")).toMatchObject({ dir: "down", direct: 1, total: 1 });
    expect([...s.pathIds].sort()).toEqual(["focus", "up:P", "up:r3"]);
  });

  it("keeps the other side when the route is one step", () => {
    const g = tinyFixture().graph;
    const m = model(graph([...g.nodes, node("kid")], [["r0", "F", 1], ["r1", "F", 2], ["r2", "F", 1], ["F", "kid", 1]]));
    const s = scene(m, { pin: { dir: "up", id: "r0" } });
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

  it("heads each column with its steps and how many components are that far", () => {
    const m = model(dualRouteFixture().graph);
    expect(scene(m, { pin: { dir: "up", id: "P" } }).headings.map((h) => h.text)).toEqual(["Directly · 4", "2 steps away · 4"]);
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
    const s = scene(m, { pin: { dir, id: "p0" }, lists: new Set([`${dir}:F`, `${dir}:d0`]) });
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
        const s = buildScene(m, fx.focusId, routes, { ...empty, pin: { dir, id: row.node.id } });
        const route = routeIds(routes[dir], fx.focusId, row.node.id).map((id) => (id === fx.focusId ? "focus" : `${dir}:${id}`));
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

describe("nothingFurtherOut", () => {
  // W, E and Y render F directly; X renders W from further out; Y also renders
  // E. F renders K and L directly; K also renders L.
  const m = model(
    graph(
      [node("F"), node("W"), node("E"), node("Y"), node("X"), node("K"), node("L")],
      [["W", "F", 1], ["E", "F", 1], ["Y", "F", 1], ["Y", "E", 1], ["X", "W", 1], ["F", "K", 1], ["F", "L", 1], ["K", "L", 1]],
    ),
  );
  const routes = bothRoutes(m, "F");
  it.each([
    ["something renders it from further out", "up", "W", null],
    ["everything that renders it is as near", "up", "E", "Nothing further out renders E."],
    ["nothing renders it", "up", "Y", "Nothing in this repo renders Y."],
    ["everything it renders is as near", "down", "K", "K renders nothing further out."],
    ["it renders nothing", "down", "L", "L renders no other components."],
  ] as const)("%s", (_, dir, id, sentence) => {
    expect(nothingFurtherOut(m, routes[dir], dir, id)).toBe(sentence);
  });
});

describe("routeSentence", () => {
  it.each([
    ["one step, once", ["A", "F"], [1], "A renders F once."],
    ["one step, twice", ["A", "F"], [2], "A renders F twice."],
    ["one step, many times", ["A", "F"], [1234], "A renders F 1,234 times."],
    ["two steps", ["A", "B", "F"], [1, 5], "A renders B once, and B renders F 5 times."],
    ["three steps", ["A", "B", "C", "F"], [3, 1, 2], "A renders B 3 times, B renders C once, and C renders F twice."],
  ])("%s", (_, chain, uses, sentence) => {
    expect(routeSentence(chain, uses)).toBe(sentence);
  });
});
