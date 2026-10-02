/**
 * A bare JSX name JSX renders as a string (lowercase-initial or hyphenated)
 * that is a valid custom element name renders a custom element: it is a tag
 * occurrence, as a Vue template tag is. Any other such name is a
 * host element and gives nothing.
 */
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { relResolver, scanGraph } from "./shape-helpers.js";

function run(files: Record<string, string>) {
  const collector = createDiagnosticCollector();
  const { occurrences } = scanGraph(files, relResolver("/repo"), "/repo", { collector });
  return { occurrences, diagnostics: collector.drain() };
}

describe("custom-element tags in JSX", () => {
  it("a custom element name is a tag occurrence; a host element gives none", () => {
    const { occurrences, diagnostics } = run({
      "src/App.tsx": `export const App = () => <x-card label="a"><div/></x-card>;`,
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({ kind: "custom-element", tagName: "x-card", source: { type: "unknown" } });
    expect(occurrences[0]?.via).toEqual({ kind: "html-tag" });
    expect(occurrences[0]?.props).toEqual({ label: { tier: "written", value: "a" } });
    expect(occurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "App", source: { type: "local", filePath: "src/App.tsx" } });
    expect(diagnostics).toEqual([]);
  });

  it("a hyphenated name is never a binding: a valid custom element name is a tag, any other gives nothing", () => {
    const { occurrences, diagnostics } = run({
      "src/App.tsx": "export const App = () => <main><X-Card/><Font-Face/><_x-card/></main>;",
    });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "custom-element", tagName: "X-Card", source: { type: "unknown" } },
    ]);
    expect(diagnostics).toEqual([]);
  });
});
