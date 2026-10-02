import { describe, it, expect } from "vitest";
import { buildComponentSeeds } from "../../src/seeds.js";
import { buildLocalIndex } from "../../src/local-index/index.js";
import { extractReactDeclaredProps } from "../../src/local-index/declared-props.js";
import { parseByExt } from "../../src/parse-by-ext.js";
import type { LocalDefinition, LocalDefinitionIndex } from "../../src/local-index/types.js";
import type { DeclaredPropApi } from "@scoutui/scan-format";
import type { WorkspaceGraph } from "../../src/workspace/types.js";

describe("buildComponentSeeds: local definitions", () => {
  it("emits a seed for each local definition in the index", () => {
    const localIndex: LocalDefinitionIndex = {
      byPath: new Map([
        [
          "src/Page.vue",
          [
            {
              componentId: {
                kind: "vue-component",
                export: "Page",
                source: { type: "local", filePath: "src/Page.vue" },
              },
              exportName: "Page",
              isDefault: true,
              detector: "vue-sfc",
              loc: { file: "src/Page.vue", line: 3, column: 9 },
            },
          ],
        ],
      ]),
      byTag: new Map(),
    };
    const seeds = buildComponentSeeds(localIndex);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.identity).toEqual({ kind: "repository-declaration", repoId: "", filePath: "src/Page.vue", exportName: "Page" });
    expect(seeds[0]?.definition).toEqual({ line: 3, column: 9 });
  });

  it("stamps the scan's repoId on every local seed identity", () => {
    const localIndex: LocalDefinitionIndex = {
      byPath: new Map([
        [
          "src/Page.vue",
          [
            {
              componentId: {
                kind: "vue-component",
                export: "Page",
                source: { type: "local", filePath: "src/Page.vue" },
              },
              exportName: "Page",
              isDefault: true,
              detector: "vue-sfc",
              loc: { file: "src/Page.vue", line: 3, column: 9 },
            },
          ],
        ],
      ]),
      byTag: new Map(),
    };
    const seeds = buildComponentSeeds(localIndex, undefined, undefined, rosterOf(entry("src/Card.tsx", "Card")), "example-web");
    const locals = seeds.filter((s) => s.identity.kind === "repository-declaration");
    expect(locals).toHaveLength(2);
    for (const seed of locals) expect(seed.identity).toMatchObject({ repoId: "example-web" });
  });
});

describe("buildComponentSeeds: workspace owningPackage enrichment", () => {
  it("populates owningPackage for local file inside a workspace package", () => {
    const workspaceGraph: WorkspaceGraph = {
      packageManager: "yarn",
      rootPath: "/repo",
      rootPackageName: "root",
      packages: [
        { name: "@a/foo", absolutePath: "/repo/packages/foo", packageJson: { name: "@a/foo" } },
      ],
    };
    const seeds = buildComponentSeeds(undefined, undefined, workspaceGraph, rosterOf(entry("packages/foo/src/Button.tsx", "Button")));
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.owningPackage).toBe("@a/foo");
  });

  it("omits owningPackage for local file outside any workspace package", () => {
    const workspaceGraph: WorkspaceGraph = {
      packageManager: "yarn",
      rootPath: "/repo",
      rootPackageName: "root",
      packages: [],
    };
    const seeds = buildComponentSeeds(undefined, undefined, workspaceGraph, rosterOf(entry("src/App.tsx", "App")));
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.owningPackage).toBeUndefined();
  });
});

const entry = (
  filePath: string,
  symbol: string,
  exportName = symbol,
  isDefault = false,
  loc = { line: 3, column: 7 },
) => ({
  filePath,
  symbol,
  exportName,
  kind: "react-component" as const,
  loc,
  isDefault,
});

const rosterOf = (...entries: ReturnType<typeof entry>[]) => ({
  declarationOf: (filePath: string, exportName: string) => {
    const e = entries.find((x) => x.filePath === filePath && x.exportName === exportName);
    return e && { symbol: e.symbol, loc: e.loc };
  },
  localEntries: () => entries,
});

const extractedFrom = (filePath: string, lines: string[]) => {
  const parsed = parseByExt(filePath, lines.join("\n"));
  if (parsed.kind !== "babel") throw new Error(`expected babel kind, got ${parsed.kind}`);
  return new Map([[filePath, extractReactDeclaredProps(parsed.ast)]]);
};

describe("buildComponentSeeds: local React rows come from the registry", () => {
  it("seeds a registry entry with its declaration position and default standing", () => {
    const seeds = buildComponentSeeds(buildLocalIndex([]), undefined, undefined, rosterOf(entry("src/dropdown-control.js", "Dropdown", "Dropdown", true)));
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.identity).toMatchObject({ kind: "repository-declaration", exportName: "Dropdown", filePath: "src/dropdown-control.js" });
    expect(seeds[0]?.definition).toEqual({ line: 3, column: 7 });
    expect(seeds[0]?.isDefaultExport).toBe(true);
    expect(seeds[0]?.declared).toBeUndefined();
  });

  it("takes the declared props extracted for the entry's symbol", () => {
    const declared: DeclaredPropApi = { props: { label: {} }, hasRest: false };
    const declaredByFile = new Map([
      ["src/a.tsx", new Map<string, DeclaredPropApi>([["ButtonImpl", declared], ["Button", { props: { other: {} }, hasRest: true }]])],
    ]);
    const seeds = buildComponentSeeds(undefined, undefined, undefined, rosterOf(entry("src/a.tsx", "ButtonImpl", "Button")), "", declaredByFile);
    expect(seeds[0]?.identity).toMatchObject({ exportName: "Button" });
    expect(seeds[0]?.declared).toEqual(declared);
  });

  it("carries no declared props when none were extracted for the entry's symbol", () => {
    const declaredByFile = new Map([["src/a.tsx", new Map([["Other", { props: { label: {} }, hasRest: false }]])]]);
    const seeds = buildComponentSeeds(undefined, undefined, undefined, rosterOf(entry("src/a.tsx", "Button")), "", declaredByFile);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.declared).toBeUndefined();
  });

  it.each([
    [
      "arrow",
      "src/atlas.jsx",
      "Plate",
      [
        "export function Atlas() { const Plate = ({ inner }) => <i>{inner}</i>; return <Plate inner=\"x\" />; }",
        "export const Plate = ({ scale }) => scale * 2;",
      ],
      { line: 2, column: 13 },
    ],
    [
      "function declaration",
      "src/folio.jsx",
      "Leaf",
      [
        "export function Folio() { const Leaf = ({ inner }) => <i>{inner}</i>; return <Leaf inner=\"x\" />; }",
        "export function Leaf({ size }) { return size + 1; }",
      ],
      { line: 2, column: 7 },
    ],
  ])(
    "a nested member whose name resolves to a module-scope %s that is not a member carries no declared props",
    (_form, filePath, name, lines, moduleScopeLoc) => {
      const nested = { line: 1, column: 32 };
      const declaredByFile = extractedFrom(filePath, lines);
      expect(declaredByFile.get(filePath)?.has(name)).toBe(true);
      const roster = {
        declarationOf: (f: string, n: string) => (f === filePath && n === name ? { symbol: name, loc: moduleScopeLoc } : undefined),
        localEntries: () => [entry(filePath, name, name, false, nested)],
      };
      const seeds = buildComponentSeeds(undefined, undefined, undefined, roster, "", declaredByFile);
      expect(seeds[0]?.definition).toEqual(nested);
      expect(seeds[0]?.declared).toBeUndefined();
    },
  );

  it("leaves a vue definition and its own declared props untouched", () => {
    const vueDef: LocalDefinition = {
      componentId: { kind: "vue-component", export: "Card", source: { type: "local", filePath: "src/Card.vue" } },
      exportName: "Card",
      isDefault: true,
      detector: "vue-sfc",
      declared: { props: { tone: {} }, hasRest: false },
    };
    const declaredByFile = new Map([["src/Card.vue", new Map([["Card", { props: { label: {} }, hasRest: false }]])]]);
    const seeds = buildComponentSeeds(buildLocalIndex([vueDef]), undefined, undefined, rosterOf(), "", declaredByFile);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.declared).toEqual({ props: { tone: {} }, hasRest: false });
  });
});
