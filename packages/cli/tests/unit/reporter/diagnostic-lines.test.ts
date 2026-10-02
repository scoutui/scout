import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../../src/diagnostic.js";
import { diagnosticLogLines } from "../../../src/reporter/diagnostic-lines.js";

const ref = (line: number): Diagnostic => ({
  code: "unresolved-reference",
  severity: "info",
  filePath: "src/App.tsx",
  line,
  column: 3,
  symbol: "Widget",
  memberChain: [],
});

describe("diagnosticLogLines", () => {
  it.each<[string, Diagnostic, string]>([
    [
      "a re-export cycle",
      { code: "cycle-detected", severity: "warning", filePath: "node_modules/@example/ui/index.js", exportName: "Button" },
      "The re-exports of Button in node_modules/@example/ui/index.js loop back on themselves, so its occurrences aren't matched to a component.",
    ],
    [
      "a re-export chain too long to follow",
      { code: "chain-too-deep", severity: "warning", filePath: "node_modules/@example/ui/deep.js", exportName: "Button", depth: 32 },
      "Stopped following the re-exports of Button after 32 files (at node_modules/@example/ui/deep.js), so its occurrences aren't matched to a component.",
    ],
    [
      "a lazy import it can't follow",
      { code: "lazy-import-unsupported", severity: "warning", filePath: "src/App.tsx", line: 24, column: 6, specifier: "./Panel", detail: "the import() target could not be resolved to a component" },
      "src/App.tsx:24:6: couldn't tell which component import('./Panel') loads, so this usage isn't counted.",
    ],
    [
      "a stale auto-import entry",
      { code: "auto-import-stale-entry", severity: "warning", filePath: ".nuxt/components.d.ts", componentName: "AppCard", target: "components/AppCard.vue" },
      ".nuxt/components.d.ts lists AppCard at components/AppCard.vue, which no longer exists. Regenerate that file (for Nuxt, run npx nuxt prepare) and scan again.",
    ],
    [
      "an unprepared Nuxt app",
      { code: "auto-import-manifest-missing", severity: "warning", filePath: ".nuxt/components.d.ts", detail: "no components manifest" },
      "This Nuxt app hasn't been prepared, so auto-imported components aren't counted. Run npx nuxt prepare and scan again.",
    ],
  ])("prints one plain line for %s", (_case, diagnostic, line) => {
    expect(diagnosticLogLines([diagnostic])).toEqual({ warnings: [line], counts: [] });
  });

  it("prints a count per kind of info diagnostic, in the singular and the plural", () => {
    expect(
      diagnosticLogLines([
        ref(1),
        ref(5),
        { code: "late-bound-render", severity: "info", filePath: "src/App.tsx", line: 4, column: 1, symbol: "Comp", memberChain: [] },
      ]),
    ).toEqual({
      warnings: [],
      counts: [
        "2 usages couldn't be matched to a component and weren't counted.",
        "1 component passed in as a prop or argument wasn't counted.",
      ],
    });
    expect(diagnosticLogLines([ref(1)]).counts).toEqual(["1 usage couldn't be matched to a component and wasn't counted."]);
  });

  it("prints nothing for no diagnostics", () => {
    expect(diagnosticLogLines([])).toEqual({ warnings: [], counts: [] });
  });
});
