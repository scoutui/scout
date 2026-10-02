/**
 * Owners are registry members, or they fan out. Owner classification
 * asks the registry instead of re-deriving component-ness: a declaration the
 * registry admits owns its JSX; a JSX-returning declaration it does not admit
 * is a helper whose JSX belongs to its callers. Every case runs the real
 * pipeline (oxc → emitReact → resolve).
 */
import { describe, expect, it } from "vitest";
import { relResolver, scanGraph } from "./shape-helpers.js";

type Resolved = ReturnType<typeof scanGraph>;

const memberNames = (g: Resolved) => g.registry.localEntries().map((e) => e.exportName).sort();

/** Local owners stamped on occurrences that the registry does not contain. */
const orphanOwners = (g: Resolved) =>
  g.occurrences
    .map((o) => o.rawOwnerComponentId)
    .flatMap((owner) =>
      owner?.kind === "react-component" && owner.source.type === "local" && !g.registry.hasLocal(owner.source.filePath, owner.export)
        ? [owner.export]
        : [],
    );

/** The occurrence whose identity is `name`, if any. */
const occurrenceOf = (g: Resolved, name: string) =>
  g.occurrences.find((o) => (o.rawComponentId as { export?: string }).export === name);

const ownerOf = (g: Resolved, name: string) => (occurrenceOf(g, name)?.rawOwnerComponentId as { export?: string } | null | undefined)?.export ?? null;

const hops = (g: Resolved, name: string) => (occurrenceOf(g, name)?.viaChain ?? []).map((v) => v.kind);

describe("owners are registry members", () => {
  it("a capitalised JSX-returning declaration consumed only as a callee is a helper: its JSX belongs to the caller", () => {
    const g = scanGraph(
      {
        "src/CreateEventType.tsx": `
          import { Button, Wrapper } from "@example/design-system";
          const ActionButtons = ({ label }) => (<div><Button>{label}</Button></div>);
          export const Form = () => <Wrapper actions={ActionButtons({ label: "save" })} />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Form"]);
    expect(ownerOf(g, "Button")).toBe("Form");
    expect(hops(g, "Button")).toContain("helper-call");
    expect(orphanOwners(g)).toEqual([]);
  });

  it("the same helper called inside an inline callback has no indexed caller: its JSX has no owner, and no orphan", () => {
    // `SubmitButton={(p) => ActionButtons({ … })}`: the caller index does not
    // descend into inline callbacks, so the helper has no caller edge.
    const g = scanGraph(
      {
        "src/CreateEventType.tsx": `
          import { Button, Wrapper } from "@example/design-system";
          const ActionButtons = ({ label }) => (<div><Button>{label}</Button></div>);
          export const Form = () => <Wrapper SubmitButton={(pending) => ActionButtons({ label: pending })} />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Form"]);
    expect(ownerOf(g, "Button")).toBeNull();
    expect(hops(g, "Button")).toContain("helper-call");
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a component selected as a value owns its own JSX; the selector is a route, not an owner", () => {
    const g = scanGraph(
      {
        "src/MeetingName.tsx": `
          import { Fragment } from "react";
          import { Button } from "@example/design-system";
          const CTAContainer = ({ children }) => <Button>{children}</Button>;
          const pick = (isHost) => (isHost ? CTAContainer : Fragment);
          export const MeetingName = ({ isHost }) => { const W = pick(isHost); return <W>hi</W>; };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toContain("CTAContainer");
    expect(memberNames(g)).not.toContain("pick");
    expect(ownerOf(g, "Button")).toBe("CTAContainer");
    expect(hops(g, "Button")).not.toContain("helper-call");
    expect(orphanOwners(g)).toEqual([]);
  });

  it("a JSX-returning declaration nothing consumes is a helper with no callers: its JSX has no owner", () => {
    const g = scanGraph(
      {
        "src/Dead.tsx": `
          import { Button } from "@example/design-system";
          const Dead = () => <Button />;
          export const App = () => <div />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["App"]);
    expect(occurrenceOf(g, "Button")).toBeDefined();
    expect(ownerOf(g, "Button")).toBeNull();
    expect(orphanOwners(g)).toEqual([]);
  });

  it("parity: a rendered component owns its JSX", () => {
    const g = scanGraph(
      {
        "src/List.tsx": `
          import { Button } from "@example/design-system";
          const Row = () => <Button />;
          export const List = () => <ul><Row /></ul>;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["List", "Row"]);
    expect(ownerOf(g, "Button")).toBe("Row");
  });

  it("a body-local function shadowing a module helper is the callee: the module helper's JSX does not fan out to the caller", () => {
    const g = scanGraph(
      {
        "src/Panel.tsx": `
          import { Badge, Icon } from "@example/design-system";
          function helper() { return <Badge />; }
          export function Panel() {
            const helper = () => <Icon />;
            helper();
            return <div />;
          }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(ownerOf(g, "Badge")).toBeNull();
    expect(hops(g, "Badge")).toContain("helper-call");
    expect(orphanOwners(g)).toEqual([]);
  });

  it("parity: a lowercase render helper's JSX belongs to its caller", () => {
    const g = scanGraph(
      {
        "src/Panel.tsx": `
          import { Icon } from "@example/design-system";
          const renderIcon = () => <Icon />;
          export const Panel = () => <div>{renderIcon()}</div>;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );

    expect(memberNames(g)).toEqual(["Panel"]);
    expect(ownerOf(g, "Icon")).toBe("Panel");
    expect(hops(g, "Icon")).toContain("helper-call");
  });

  it("an alias of a lowercase render helper is not one of its callers: the helper's JSX belongs only to the component that calls it", () => {
    const g = scanGraph(
      {
        "src/Panel.tsx": `
          import { Icon } from "@example/design-system";
          const renderIcon = () => <Icon />;
          export const iconRenderer = renderIcon;
          export const Panel = () => <div>{renderIcon()}</div>;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    const icons = g.occurrences.filter((o) => (o.rawComponentId as { export?: string }).export === "Icon");
    expect(icons.map((o) => (o.rawOwnerComponentId as { export?: string } | null | undefined)?.export ?? null)).toEqual(["Panel"]);
    expect(icons.map((o) => o.viaChain.map((v) => v.kind))).toEqual([["helper-call", "direct-import"]]);
  });

  it("credits a component declared in one function whatever a same-named non-component another function declares first", () => {
    const g = scanGraph({
      "src/App.tsx": `
        const makeThing = () => () => <b />;
        export function B() { const Item = "x"; return <i>{Item}</i>; }
        export function A() { const Item = makeThing(); return <Item />; }
      `,
    });
    expect(g.occurrences.map((o) => (o.rawComponentId as { export?: string }).export)).toEqual(["Item"]);
    expect(ownerOf(g, "Item")).toBe("A");
  });
});
