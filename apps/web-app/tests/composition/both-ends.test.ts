import { describe, expect, it } from "vitest";
import { bothRoutes } from "@/components/component-detail/composition/graph-model";
import {
  buildBothEnds,
  nameBreaks,
  NO_ENDS,
  normaliseEnds,
  pickDirect,
  pickFound,
  pickTop,
  type Ends,
} from "@/components/component-detail/composition/both-ends";
import { graph, model, node } from "./graph-fixtures";

// Pages P0 (app/a/page.tsx) and P1 (app/b/page.tsx), both named Page:
// P0 → Shell → Card → F, P1 → Card, Card renders F 5 times, Solo renders F
// once and nothing renders Solo, F → Kid → Leaf.
const m = model(
  graph(
    [
      node("F"),
      node("Card"),
      node("Shell"),
      node("Solo"),
      node("Kid"),
      node("Leaf"),
      node("P0", { displayName: "Page", filePath: "app/a/page.tsx" }),
      node("P1", { displayName: "Page", filePath: "app/b/page.tsx" }),
    ],
    [["P0", "Shell"], ["Shell", "Card"], ["Card", "F", 5], ["P1", "Card"], ["Solo", "F"], ["F", "Kid"], ["Kid", "Leaf"]],
  ),
);
const routes = bothRoutes(m, "F");
const view = (ends: Ends) => buildBothEnds(m, "F", routes, normaliseEnds(m, "F", routes, ends));
const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id);

describe("buildBothEnds", () => {
  it("lists every top-level component by steps, every direct renderer by uses, and what it renders directly", () => {
    const v = view(NO_ENDS);
    expect(ids(v.top)).toEqual(["Solo", "P1", "P0"]);
    expect(v.top.map((r) => r.steps)).toEqual([1, 2, 3]);
    expect(v.topTotal).toBe(3);
    expect(ids(v.direct)).toEqual(["Card", "Solo"]);
    expect(v.direct.map((r) => r.uses)).toEqual([5, 1]);
    expect(ids(v.renders)).toEqual(["Kid"]);
    expect(v.totals).toEqual({ up: 5, down: 2 });
    expect(v.route.ids).toEqual([]);
    expect(v.between).toEqual([]);
  });

  it("tells same-named pages apart by folder", () => {
    const pages = view(NO_ENDS).top.filter((r) => r.node.displayName === "Page");
    expect(pages.map((r) => r.fragment)).toEqual(["b", "a"]);
  });

  it("draws a picked top's route, with the steps between the two lists as boxes", () => {
    const v = view({ pin: null, top: "P0" });
    expect(v.route).toEqual({ dir: "up", ids: ["P0", "Shell", "Card", "F"] });
    expect(ids(v.between)).toEqual(["Shell"]);
    expect(v.picked).toEqual({ top: "P0", direct: "Card", renders: null });
  });

  it("narrows the top level to the routes through a picked direct renderer", () => {
    const v = view({ pin: { dir: "up", id: "Card" }, top: null });
    expect(ids(v.top)).toEqual(["P1", "P0"]);
    expect(v.topTotal).toBe(3);
    expect(v.through?.id).toBe("Card");
    expect(v.route.ids).toEqual(["Card", "F"]);
    expect(v.between).toEqual([]);
  });

  it("draws a component found in between on the route", () => {
    const v = view(pickFound(m, "up", "Shell"));
    expect(v.route.ids).toEqual(["Shell", "Card", "F"]);
    expect(ids(v.between)).toEqual(["Shell"]);
    expect(ids(v.top)).toEqual(["P0"]);
  });

  it("picks a component that is both top level and a direct renderer in both lists, with no box", () => {
    const v = view({ pin: null, top: "Solo" });
    expect(v.route.ids).toEqual(["Solo", "F"]);
    expect(v.picked).toEqual({ top: "Solo", direct: "Solo", renders: null });
    expect(v.between).toEqual([]);
  });

  it("draws a route on the renders side past the direct row", () => {
    const v = view({ pin: { dir: "down", id: "Leaf" }, top: null });
    expect(v.route).toEqual({ dir: "down", ids: ["F", "Kid", "Leaf"] });
    expect(ids(v.between)).toEqual(["Leaf"]);
    expect(v.picked).toEqual({ top: null, direct: null, renders: "Kid" });
  });
});

describe("normaliseEnds", () => {
  it.each([
    ["a top-level pin becomes the top end", { pin: { dir: "up", id: "P1" }, top: null }, { pin: null, top: "P1" }],
    ["a pin the graph doesn't reach is dropped", { pin: { dir: "up", id: "gone" }, top: "P0" }, { pin: null, top: "P0" }],
    ["a top that isn't top level is dropped", { pin: null, top: "Card" }, NO_ENDS],
    [
      "a top no route through the pin reaches is dropped",
      { pin: { dir: "up", id: "Shell" }, top: "P1" },
      { pin: { dir: "up", id: "Shell" }, top: null },
    ],
    [
      "a renders-side pin drops the top",
      { pin: { dir: "down", id: "Kid" }, top: "P0" },
      { pin: { dir: "down", id: "Kid" }, top: null },
    ],
  ] as const)("%s", (_, ends, expected) => {
    expect(normaliseEnds(m, "F", routes, ends as Ends)).toEqual(expected);
  });
});

describe("picks", () => {
  it("toggles the top end and keeps the component the route runs through", () => {
    const through: Ends = { pin: { dir: "up", id: "Card" }, top: null };
    expect(pickTop(through, "P0")).toEqual({ pin: { dir: "up", id: "Card" }, top: "P0" });
    expect(pickTop({ pin: { dir: "up", id: "Card" }, top: "P0" }, "P0")).toEqual(through);
    expect(pickTop({ pin: { dir: "down", id: "Kid" }, top: null }, "P0")).toEqual({ pin: null, top: "P0" });
  });

  it("toggles a direct renderer and keeps the top only when a route through it reaches the top", () => {
    expect(pickDirect(m, "F", routes, { pin: null, top: "P0" }, "Card")).toEqual({ pin: { dir: "up", id: "Card" }, top: "P0" });
    expect(pickDirect(m, "F", routes, { pin: null, top: "P0" }, "Solo")).toEqual({ pin: { dir: "up", id: "Solo" }, top: null });
    expect(pickDirect(m, "F", routes, { pin: { dir: "up", id: "Card" }, top: "P0" }, "Card")).toEqual({ pin: null, top: "P0" });
  });

  it.each([
    ["a top-level component", "up", "P0", { pin: null, top: "P0" }],
    ["a component in between", "up", "Shell", { pin: { dir: "up", id: "Shell" }, top: null }],
    ["a component it renders", "down", "Leaf", { pin: { dir: "down", id: "Leaf" }, top: null }],
  ] as const)("Find picks %s", (_, dir, id, expected) => {
    expect(pickFound(m, dir, id)).toEqual(expected);
  });
});

describe("nameBreaks", () => {
  it.each([
    ["OnboardingMigrateMembersBrowserView", ["Onboarding", "Migrate", "Members", "Browser", "View"]],
    ["HTMLInput2Field", ["HTMLInput2", "Field"]],
    ["event-types/[type]", ["event-", "types/", "[type]"]],
    ["Button", ["Button"]],
  ])("%s", (name, parts) => {
    expect(nameBreaks(name)).toEqual(parts);
  });
});
