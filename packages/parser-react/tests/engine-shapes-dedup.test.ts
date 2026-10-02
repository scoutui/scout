/**
 * One JSX call site produces one occurrence per identity it credits under
 * each owner. A tag's evaluation can hold several credited terminals
 * naming the same identity: a factory product whose returned function has N
 * `return <JSX>` branches, or a union whose branches are the same component.
 * A module-scope element read twice in one component is cloned per read. The
 * compaction collapses each to one record.
 */
import { describe, expect, it } from "vitest";
import { lineOf, scan } from "./shape-helpers.js";

const CARD = { kind: "react-component", export: "Card", source: { type: "local", filePath: "src/Setup.tsx" } };

describe("occurrence dedup", () => {
  it("emits one occurrence for a factory product whose function has three JSX returns", () => {
    const source = `
      const makeCard = () => (p) => { if (p.a) return <b />; if (p.b) return <i />; return <u />; };
      const Card = makeCard();
      export function App() { return <Card />; }
    `;
    const atCard = scan({ "src/Setup.tsx": source }).filter((o) => o.line === lineOf(source, "<Card"));
    expect(atCard.map((o) => o.rawComponentId)).toEqual([CARD]);
  });

  it("emits one occurrence for a union whose branches are the same component", () => {
    const source = `
      const Card = () => <div />;
      export function App({ flag }) { const Either = flag ? Card : Card; return <Either />; }
    `;
    const atEither = scan({ "src/Setup.tsx": source }).filter((o) => o.line === lineOf(source, "<Either"));
    expect(atEither.map((o) => o.rawComponentId)).toEqual([CARD]);
  });

  it("keeps one occurrence per element for a module-scope element read twice in one component", () => {
    const source = `
      const Card = () => <div />;
      const Frame = ({ children }) => <section>{children}</section>;
      const slot = <Frame><Card /></Frame>;
      export function App() { return <main>{slot}{slot}</main>; }
    `;
    const atSlot = scan({ "src/Setup.tsx": source }).filter((o) => o.line === lineOf(source, "const slot"));
    expect(atSlot.map((o) => o.rawComponentId)).toEqual([{ ...CARD, export: "Frame" }, CARD]);
  });

  it("owns a module-scope tag by each function that reads it, as it owns a component element", () => {
    const credits = (element: string) => {
      const source = `
        import { Icon } from "@example/ui";
        const el = ${element};
        function RenderIcon() { return el; }
        export const C = () => <main>{el}{RenderIcon()}</main>;
      `;
      return scan({ "src/Setup.tsx": source })
        .filter((o) => o.line === lineOf(source, "const el"))
        .map((o) => [(o.rawOwnerComponentId as { export: string } | undefined)?.export, o.viaChain.map((v) => v.kind)]);
    };
    expect(credits("<x-icon />")).toEqual([
      ["RenderIcon", ["prop-forward"]],
      ["C", ["prop-forward"]],
    ]);
    expect(credits("<Icon />")).toEqual(credits("<x-icon />"));
  });
});
