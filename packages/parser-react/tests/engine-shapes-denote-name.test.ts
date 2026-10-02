import { describe, expect, it } from "vitest";
import { denoteName } from "@scoutui/reference-graph";
import { buildGraph, pathResolver } from "./shape-helpers.js";

const ROOT = "/repo";

// A custom-element constructor named outside any render, the way a
// registration names it: the engine answers with the declaration or package
// export a render of the name would credit.
const graph = buildGraph(
  {
    "src/card.ts": "export default class Card extends HTMLElement {}\n",
    "src/register.ts": [
      'import Card from "./card";',
      'import { KitButton } from "@example/kit";',
      "class Local extends HTMLElement {}",
      'customElements.define("x-card", Card);',
      'customElements.define("kit-button", KitButton);',
      'customElements.define("x-local", Local);',
    ].join("\n"),
  },
  (from, spec) => (spec.startsWith(".") ? `${pathResolver(ROOT)(from, spec)}.ts` : null),
  ROOT,
);

describe("denoteName", () => {
  it("denotes an imported class by its declaration file and name", () => {
    expect(denoteName(graph, { kind: "binding", filePath: "src/register.ts", symbol: "Card" })).toEqual({
      rawComponentId: { kind: "react-component", export: "Card", source: { type: "local", filePath: "src/card.ts" } },
    });
  });

  it("denotes a class declared in the file itself", () => {
    expect(denoteName(graph, { kind: "binding", filePath: "src/register.ts", symbol: "Local" })).toEqual({
      rawComponentId: { kind: "react-component", export: "Local", source: { type: "local", filePath: "src/register.ts" } },
    });
  });

  it("denotes a package import by its package", () => {
    expect(denoteName(graph, { kind: "binding", filePath: "src/register.ts", symbol: "KitButton" })).toEqual({
      rawComponentId: { kind: "react-component", export: "KitButton", source: { type: "external", package: "@example/kit" } },
    });
  });

  it("denotes a module's export as a file imports it", () => {
    expect(denoteName(graph, { kind: "export", fromFile: "src/register.ts", specifier: "./card", imported: "default" })).toEqual({
      rawComponentId: { kind: "react-component", export: "Card", source: { type: "local", filePath: "src/card.ts" } },
    });
  });

  it("denotes nothing for a name the file does not bind", () => {
    expect(denoteName(graph, { kind: "binding", filePath: "src/register.ts", symbol: "Missing" })).toBeNull();
  });
});
