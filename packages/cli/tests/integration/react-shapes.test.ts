/**
 * Semantic gate for the react-shapes fixture: one repository holding the
 * React engine shapes, each under `src/<shape>/`, scanned once.
 *
 * These assertions state what the artefact must contain, which the
 * byte-identity baseline can't: a recaptured baseline passes whatever changed.
 */
import { isDeepStrictEqual } from "node:util";
import { describe, it, expect, beforeAll } from "vitest";
import { isKind, resolvedOccurrences, type ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact<Diagnostic>;
let raw: string;

beforeAll(async () => {
  ({ artifact: out, raw } = await scanFixture("react-shapes"));
}, 120_000);

const inShape = (shape: string, filePath: string) => filePath.startsWith(`src/${shape}/`);

const pkg = (exportName: string) => ({
  kind: "package-export",
  packageName: "@example/react-ds",
  publicEntry: "",
  exportName,
});
const pkgOf = (packageName: string, exportName: string) => ({
  kind: "package-export",
  packageName,
  publicEntry: "",
  exportName,
});
const local = (shape: string, file: string, exportName: string) => ({
  kind: "repository-declaration",
  repoId: "react-shapes",
  filePath: `src/${shape}/${file}`,
  exportName,
});
const imported = (specifier: string, name: string) => ({ kind: "import", specifier, name });
const hoc = (callee: string) => ({ kind: "hoc", callee });
const lazy = (callee: string) => ({ kind: "lazy", callee });
const helperCall = (shape: string, file: string, callee: string) => ({
  kind: "helper-call",
  callee,
  calleeFile: `src/${shape}/${file}`,
});
const propForward = (shape: string, file: string, bindingName: string, line: number, column: number) => ({
  kind: "prop-forward",
  bindingName,
  constructionSite: { file: `src/${shape}/${file}`, line, column },
});
const dynamicMap = (shape: string, file: string, mapName: string, line: number, column: number) => ({
  kind: "dynamic-map",
  mapName,
  mapLoc: { file: `src/${shape}/${file}`, line, column },
});

/** One expected occurrence; `at` is `<file>:<line>:<column>` within its shape. */
function row(
  at: string,
  component: unknown,
  owner: unknown,
  trace: unknown[],
  props: Record<string, unknown> = {},
  { credit = { kind: "render" } }: { credit?: unknown } = {},
) {
  return { at, component, owner, credit, trace, props };
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every occurrence under `src/<shape>/` (or in one file of it), in source
 * order, with component and owner ids replaced by their identities.
 */
function rendersIn(shape: string, file?: string) {
  const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
  return out.occurrences
    .filter((o) => (file ? o.filePath === `src/${shape}/${file}` : inShape(shape, o.filePath)))
    .map((o) => ({
      at: `${o.filePath.slice(`src/${shape}/`.length)}:${o.line}:${o.column}`,
      component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
      owner: o.ownerComponentId === undefined ? undefined : identityOf.get(o.ownerComponentId),
      credit: o.credit,
      trace: o.trace,
      props: o.props,
      order: [o.filePath, o.line, o.column] as const,
    }))
    .sort(
      (a, b) =>
        ordinal(a.order[0], b.order[0]) ||
        a.order[1] - b.order[1] ||
        a.order[2] - b.order[2] ||
        ordinal(JSON.stringify(a.component), JSON.stringify(b.component)),
    )
    .map(({ order: _order, ...rest }) => rest);
}

/** Package-export identities rendered in `shape`, as `exportName` strings, sorted. */
function externalExports(shape: string): string[] {
  const byId = new Map(out.components.map((c) => [c.id, c.identity]));
  const names = resolvedOccurrences(out.occurrences)
    .filter((o) => inShape(shape, o.filePath))
    .flatMap((o) => {
      const identity = byId.get(o.resolution.componentId);
      return identity?.kind === "package-export" ? [identity.exportName] : [];
    });
  return [...new Set(names)].sort();
}

/** Repository-declaration identities declared in `shape`, as `exportName` strings. */
function localExports(shape: string): string[] {
  return out.components.flatMap((c) =>
    c.identity.kind === "repository-declaration" && inShape(shape, c.identity.filePath) ? [c.identity.exportName] : [],
  );
}

/** The component row for a repository declaration in `shape`, by export name (and file, if given). */
function componentIn(shape: string, exportName: string, file?: string) {
  return out.components.find(
    (c) =>
      c.identity.kind === "repository-declaration" &&
      (file ? c.identity.filePath === `src/${shape}/${file}` : inShape(shape, c.identity.filePath)) &&
      c.identity.exportName === exportName,
  );
}

/** The component row with `identity`. */
const componentOf = (identity: object) => out.components.find((c) => isDeepStrictEqual(c.identity, identity));
const idOf = (identity: object) => componentOf(identity)?.id ?? "";

/** Every occurrence credited to component `id`. */
function occurrencesOf(id: string | undefined) {
  return out.occurrences.filter((o) => o.resolution.status === "resolved" && o.resolution.componentId === id);
}

/** Every diagnostic under `src/<shape>/`, in source order. */
function diagnosticsIn(shape: string) {
  return out.diagnostics
    .filter((d) => "filePath" in d && inShape(shape, d.filePath))
    .sort((a, b) => ("line" in a ? a.line : 0) - ("line" in b ? b.line : 0) || ("column" in a ? a.column : 0) - ("column" in b ? b.column : 0));
}

describe("integration: react-shapes fixture", () => {
  it("emits no absolute filesystem paths anywhere in the artefact", () => {
    // Matches the path segment anywhere in a string value, not just at its
    // start, so a mid-string leak (a `file:///Users/...` URL) fails too.
    expect(raw).not.toMatch(/\/(Users|home|private|tmp)\//);
  });

  it("credits every external identity to a stand-in package the repository declares", () => {
    const declared = ["@example/design-system", "@example/owner-edges", "@example/react-ds"];
    for (const c of out.components) {
      if (c.identity.kind === "package-export") expect(declared).toContain(c.identity.packageName);
    }
  });

  it("names a component in the artefact for every owner an occurrence has", () => {
    const ids = new Set(out.components.map((c) => c.id));
    expect(out.occurrences.filter((o) => o.ownerComponentId !== undefined && !ids.has(o.ownerComponentId))).toEqual([]);
  });

  describe("react-engine-shapes", () => {
    const S = "react-engine-shapes";
    const app = local(S, "App.tsx", "App");

    it("reaches every external leaf the working shapes bottom out in", () => {
      // The wrapper, iteration and cross-file-namespace shapes all bottom out
      // in the stand-in package's leaves. Root arrives only via the cross-file
      // namespace object, so its presence proves that shape resolves.
      const externals = externalExports(S);
      expect(externals).toContain("Button");
      expect(externals).toContain("TextInput");
      expect(externals).toContain("Card");
      expect(externals).toContain("RadioArea"); // the bare alias
      expect(externals).toContain("Root"); // the cross-file namespace
      expect(externals).toContain("Banner"); // the anonymous default-export arrow
    });

    it("credits each shape's component where App renders it", () => {
      // `FactoryButton` is its factory's product, so the memo(forwardRef())
      // inside the factory adds no hoc step.
      expect(rendersIn(S, "App.tsx")).toEqual([
        row("App.tsx:23:6", local(S, "Wrappers.tsx", "BoundJsx"), app, [imported("./Wrappers", "BoundJsx")]),
        row("App.tsx:24:6", local(S, "Wrappers.tsx", "FactoryButton"), app, [imported("./Wrappers", "FactoryButton")]),
        row("App.tsx:25:6", local(S, "Wrappers.tsx", "Conditional"), app, [imported("./Wrappers", "Conditional"), hoc("memo")]),
        row("App.tsx:26:6", pkg("RadioArea"), app, [imported("./Wrappers", "Item")]),
        row("App.tsx:27:6", local(S, "Wrappers.tsx", "NsForwarded"), app, [imported("./Wrappers", "NsForwarded"), hoc("forwardRef")]),
        row("App.tsx:28:6", local(S, "Wrappers.tsx", "NsMemoView"), app, [imported("./Wrappers", "NsMemo"), hoc("memo")]),
        row("App.tsx:29:6", local(S, "Wrappers.tsx", "DefaultView"), app, [imported("./Wrappers", "default"), hoc("memo")]),
        row("App.tsx:30:6", local(S, "AnonDefault.tsx", "default"), app, [imported("./AnonDefault", "default")]),
        row("App.tsx:31:6", local(S, "NamedDefault.tsx", "NamedView"), app, [imported("./NamedDefault", "default")]),
        row("App.tsx:32:6", local(S, "Iteration.tsx", "HookLeaf"), app, [imported("./Iteration", "HookLeaf")]),
        row("App.tsx:33:6", local(S, "Iteration.tsx", "DirectList"), app, [imported("./Iteration", "DirectList")], {
          rows: { tier: "dynamic" },
        }),
        row("App.tsx:34:6", local(S, "Iteration.tsx", "MemoList"), app, [imported("./Iteration", "MemoList"), hoc("memo")], {
          rows: { tier: "dynamic" },
        }),
        row("App.tsx:35:6", local(S, "Iteration.tsx", "ViaMap"), app, [imported("./Iteration", "ViaMap")], {
          k: { tier: "written", value: "list" },
        }),
        row("App.tsx:36:6", local(S, "Iteration.tsx", "ViaTernary"), app, [imported("./Iteration", "ViaTernary")], {
          c: { tier: "written", value: true },
        }),
        row("App.tsx:37:6", local(S, "Iteration.tsx", "ChildrenWrapper"), app, [imported("./Iteration", "ChildrenWrapper")]),
        row("App.tsx:38:6", local(S, "Iteration.tsx", "ExternalArrayList"), app, [imported("./Iteration", "ExternalArrayList")]),
        row("App.tsx:39:6", local(S, "NamespaceDefault.tsx", "CrossFileNamespace"), app, [
          imported("./NamespaceDefault", "CrossFileNamespace"),
        ]),
        row("App.tsx:40:6", local(S, "NamespaceDefault.tsx", "SameFileNamespace"), app, [
          imported("./NamespaceDefault", "SameFileNamespace"),
        ]),
        row("App.tsx:41:6", local(S, "Styled.tsx", "Styled"), app, [imported("./Styled", "Styled")]),
        row("App.tsx:42:6", local(S, "MapControls.tsx", "ImportValuedMap"), app, [imported("./MapControls", "ImportValuedMap")], {
          t: { tier: "written", value: "button" },
        }),
        row("App.tsx:43:6", local(S, "MapControls.tsx", "PlainBodiedMap"), app, [imported("./MapControls", "PlainBodiedMap")], {
          k: { tier: "written", value: "leafy" },
        }),
        row("App.tsx:44:6", local(S, "MapControls.tsx", "PlainTernary"), app, [imported("./MapControls", "PlainTernary")], {
          c: { tier: "written", value: true },
        }),
        row("App.tsx:45:6", local(S, "Compound.tsx", "ExternalCompound"), app, [imported("./Compound", "ExternalCompound")]),
        row("App.tsx:46:6", local(S, "Compound.tsx", "LocalCompound"), app, [imported("./Compound", "LocalCompound")]),
        row("App.tsx:47:6", local(S, "HookSeeding.tsx", "HookPage"), app, [imported("./HookSeeding", "HookPage")]),
      ]);
    });

    it("owns each leaf inside a wrapper by the component the wrapper declares", () => {
      expect(rendersIn(S, "Wrappers.tsx")).toEqual([
        row("Wrappers.tsx:7:13", pkg("Button"), local(S, "Wrappers.tsx", "BoundJsx"), [imported("@example/react-ds", "Button")]),
        row(
          "Wrappers.tsx:16:2",
          pkg("TextInput"),
          local(S, "Wrappers.tsx", "FactoryButton"),
          [imported("@example/react-ds", "TextInput")],
          { "...rest": { tier: "dynamic" }, ref: { tier: "reference", ref: "ref" } },
        ),
        row("Wrappers.tsx:21:16", pkg("Button"), local(S, "Wrappers.tsx", "Conditional"), [imported("@example/react-ds", "Button")]),
        row("Wrappers.tsx:22:9", pkg("Card"), local(S, "Wrappers.tsx", "Conditional"), [imported("@example/react-ds", "Card")]),
        row(
          "Wrappers.tsx:29:67",
          pkg("Card"),
          local(S, "Wrappers.tsx", "NsForwarded"),
          [imported("@example/react-ds", "Card")],
          { "...rest": { tier: "dynamic" } },
        ),
        row("Wrappers.tsx:32:25", pkg("TextInput"), local(S, "Wrappers.tsx", "NsMemoView"), [imported("@example/react-ds", "TextInput")]),
        row("Wrappers.tsx:36:26", pkg("Button"), local(S, "Wrappers.tsx", "DefaultView"), [imported("@example/react-ds", "Button")]),
      ]);
    });

    it("credits the anonymous and the named default export's leaf to that default", () => {
      expect([...rendersIn(S, "AnonDefault.tsx"), ...rendersIn(S, "NamedDefault.tsx")]).toEqual([
        row("AnonDefault.tsx:12:21", pkg("Banner"), local(S, "AnonDefault.tsx", "default"), [imported("@example/react-ds", "Banner")]),
        row("NamedDefault.tsx:6:24", pkg("Card"), local(S, "NamedDefault.tsx", "NamedView"), [imported("@example/react-ds", "Card")]),
      ]);
    });

    it("reaches the same-file namespace object", () => {
      // `SameFileNamespace` renders `<LocalNS.Leaf/>` and that is the only place
      // `Leaf` is rendered in the whole fixture, so its presence here is
      // caused by the static-member arm and nothing else. The paired assertion
      // is `Root` in the first test: the identical shape split across two files.
      expect(externalExports(S)).toContain("Leaf");
      expect(rendersIn(S, "NamespaceDefault.tsx")).toEqual([
        row("NamespaceDefault.tsx:6:9", pkg("Root"), local(S, "NamespaceDefault.tsx", "CrossFileNamespace"), [imported("./ns", "NS")]),
        row("NamespaceDefault.tsx:20:9", pkg("Leaf"), local(S, "NamespaceDefault.tsx", "SameFileNamespace"), []),
      ]);
    });

    it("keeps the plain-bodied map-dispatch controls, and the map-bodied components' rows from their direct-render usage", () => {
      const localNames = localExports(S);

      // Controls: plain-bodied locals keep their own rows through both a
      // MAP[k] dispatch and a ternary alias.
      expect(localNames).toContain("Leafy");
      expect(localNames).toContain("PlainA");
      expect(localNames).toContain("PlainB");

      // `DirectList` and `MemoList` are map-bodied and rendered directly in
      // App, so both have rows; ViaMap and ViaTernary reach `DirectList` too,
      // asserted with the MapControls dispatches below.
      //
      // `DirectList` is also the canary for a gutted scan: its only occurrence
      // lives in App.tsx, so it disappears if cross-file resolution breaks.
      expect(localNames).toContain("DirectList");
      expect(localNames).toContain("MemoList");
    });

    it("credits every target of a map dispatch or a ternary alias, map-bodied or plain", () => {
      const iteration = (name: string) => local(S, "Iteration.tsx", name);
      const controls = (name: string) => local(S, "MapControls.tsx", name);
      const rowsProp = { rows: { tier: "dynamic" } };
      expect(rendersIn(S, "Iteration.tsx").filter((r) => ["Iteration.tsx:23:9", "Iteration.tsx:30:9"].includes(r.at))).toEqual([
        row("Iteration.tsx:23:9", iteration("DirectList"), iteration("ViaMap"), [dynamicMap(S, "Iteration.tsx", "MAP", 20, 6)], rowsProp),
        row("Iteration.tsx:30:9", iteration("Alt"), iteration("ViaTernary"), [], rowsProp),
        row("Iteration.tsx:30:9", iteration("DirectList"), iteration("ViaTernary"), [], rowsProp),
      ]);
      expect(rendersIn(S, "MapControls.tsx")).toEqual([
        row("MapControls.tsx:9:9", pkg("Button"), controls("ImportValuedMap"), [dynamicMap(S, "MapControls.tsx", "IMPORT_MAP", 6, 6)]),
        row("MapControls.tsx:9:9", pkg("Card"), controls("ImportValuedMap"), [dynamicMap(S, "MapControls.tsx", "IMPORT_MAP", 6, 6)]),
        row("MapControls.tsx:14:20", pkg("TextInput"), controls("Leafy"), [imported("@example/react-ds", "TextInput")]),
        row("MapControls.tsx:18:9", controls("Leafy"), controls("PlainBodiedMap"), [dynamicMap(S, "MapControls.tsx", "LOCAL_MAP", 15, 6)]),
        row("MapControls.tsx:23:21", pkg("Button"), controls("PlainA"), [imported("@example/react-ds", "Button")]),
        row("MapControls.tsx:24:21", pkg("Card"), controls("PlainB"), [imported("@example/react-ds", "Card")]),
        row("MapControls.tsx:27:9", controls("PlainA"), controls("PlainTernary"), []),
        row("MapControls.tsx:27:9", controls("PlainB"), controls("PlainTernary"), []),
      ]);
    });

    it("owns the leaves of hook-returned and .map()-bodied JSX by their component", () => {
      const iteration = (name: string) => local(S, "Iteration.tsx", name);
      expect(rendersIn(S, "Iteration.tsx").filter((r) => !["Iteration.tsx:23:9", "Iteration.tsx:30:9"].includes(r.at))).toEqual([
        row("Iteration.tsx:6:19", pkg("Button"), iteration("HookLeaf"), [
          helperCall(S, "Iteration.tsx", "useModals"),
          imported("@example/react-ds", "Button"),
        ]),
        row("Iteration.tsx:14:69", pkg("Button"), iteration("DirectList"), [imported("@example/react-ds", "Button")], {
          key: { tier: "reference", ref: "r" },
        }),
        row("Iteration.tsx:17:72", pkg("TextInput"), iteration("MemoList"), [imported("@example/react-ds", "TextInput")], {
          key: { tier: "reference", ref: "r" },
        }),
        row("Iteration.tsx:27:18", pkg("Button"), iteration("Alt"), [imported("@example/react-ds", "Button")]),
        row("Iteration.tsx:39:41", pkg("Button"), iteration("ChildrenWrapper"), [imported("@example/react-ds", "Button")]),
        row("Iteration.tsx:46:64", pkg("TextInput"), iteration("ExternalArrayList"), [imported("@example/react-ds", "TextInput")], {
          key: { tier: "reference", ref: "i" },
        }),
      ]);
    });

    it("names compound members with no declaration of their own", () => {
      // A named import of a compound object from the stand-in package.
      expect(externalExports(S)).toContain("Toast.Title");
      expect(externalExports(S)).not.toContain("Toast");
      // An inline-function member on a local namespace object.
      expect(localExports(S)).toContain("LocalInline.Note");
      // The holder is an exported registry member with no occurrence and no
      // composition edge, so the unreachable-local prune drops it.
      const holder = out.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "LocalInline");
      expect(holder).toBeUndefined();
      expect(rendersIn(S, "Compound.tsx")).toEqual([
        row("Compound.tsx:8:9", pkg("Toast.Title"), local(S, "Compound.tsx", "ExternalCompound"), [
          imported("@example/react-ds", "Toast"),
        ]),
        row("Compound.tsx:16:9", local(S, "Compound.tsx", "LocalInline.Note"), local(S, "Compound.tsx", "LocalCompound"), []),
      ]);
    });

    it("credits a component passed to a hook inside a custom hook at the argument, owned by each page that calls it", () => {
      const hooks = (name: string) => local(S, "HookSeeding.tsx", name);
      expect(rendersIn(S, "HookSeeding.tsx")).toEqual([
        row("HookSeeding.tsx:6:27", pkg("Banner"), hooks("ConfirmModal"), [imported("@example/react-ds", "Banner")]),
        row("HookSeeding.tsx:9:44", hooks("ConfirmModal"), hooks("HookPage"), [helperCall(S, "HookSeeding.tsx", "useConfirmModal")], {}, {
          credit: { kind: "argument", callee: "useModalHolder", index: 0 },
        }),
      ]);
    });

    // The scan emits only an unresolved-reference diagnostic for `StyledButton`.
    it.fails("credits styled(NS.Button) at its render to the wrapped Button", () => {
      expect(rendersIn(S, "Styled.tsx")).toContainEqual(
        expect.objectContaining({ at: "Styled.tsx:13:9", component: pkg("Button"), owner: local(S, "Styled.tsx", "Styled") }),
      );
    });
  });

  describe("dynamic-map", () => {
    it("credits every entry of an import-valued map at the dispatch", () => {
      const trace = [dynamicMap("dynamic-map", "App.tsx", "COMPONENT_MAP", 3, 6)];
      const app = local("dynamic-map", "App.tsx", "App");
      expect(rendersIn("dynamic-map")).toEqual([
        row("App.tsx:11:9", pkg("Button"), app, trace),
        row("App.tsx:11:9", pkg("Card"), app, trace),
        row("App.tsx:11:9", pkg("TextInput"), app, trace),
      ]);
    });
  });

  describe("dynamic-map-via-getter", () => {
    it("follows a getter that returns a map lookup into another file, to every local entry", () => {
      const S = "dynamic-map-via-getter";
      const trace = [dynamicMap(S, "mappings.tsx", "MAP", 3, 6)];
      expect(rendersIn(S)).toEqual([
        row("App.tsx:5:9", local(S, "components.tsx", "Bar"), local(S, "App.tsx", "App"), trace),
        row("App.tsx:5:9", local(S, "components.tsx", "Foo"), local(S, "App.tsx", "App"), trace),
      ]);
    });
  });

  describe("lazy-import", () => {
    it("credits what each lazy loader resolves to: a `.then()` pick, or the module's default", () => {
      const app = local("lazy-import", "App.tsx", "App");
      expect(rendersIn("lazy-import")).toEqual([
        row("App.tsx:12:6", pkg("Button"), app, [lazy("lazy"), imported("@example/react-ds", "Button")]),
        row("App.tsx:13:6", pkg("default"), app, [lazy("dynamic"), imported("@example/react-ds", "default")]),
        row("App.tsx:14:6", pkg("Card"), app, [lazy("loadable"), imported("@example/react-ds", "Card")]),
      ]);
    });
  });

  describe("lazy-barrel-reexport", () => {
    it("credits static and lazy imports through a barrel to the file that declares the component", () => {
      const S = "lazy-barrel-reexport";
      const app = local(S, "App.tsx", "App");
      const home = local(S, "pages/home-inner.tsx", "Home");
      const settings = local(S, "pages/settings-inner.tsx", "Settings");
      expect(rendersIn(S)).toEqual([
        row("App.tsx:14:6", home, app, [imported("./pages/home", "default")]),
        row("App.tsx:15:6", settings, app, [imported("./pages/home", "Settings")]),
        row("App.tsx:16:6", home, app, [lazy("lazy"), imported("./pages/home", "default")]),
        row("App.tsx:17:6", settings, app, [lazy("lazy"), imported("./pages/home", "Settings")]),
      ]);
    });
  });

  describe("hoc-composition", () => {
    it("traces each HOC pattern to the wrapped component, withA(withB(TextInput)) through both wrappers", () => {
      const app = local("hoc-composition", "App.tsx", "App");
      expect(rendersIn("hoc-composition")).toEqual([
        row("App.tsx:26:6", pkg("Button"), app, [hoc("connect"), imported("@example/react-ds", "Button")]),
        row("App.tsx:27:6", pkg("TextInput"), app, [hoc("withRouter"), imported("@example/react-ds", "TextInput")]),
        row("App.tsx:28:6", pkg("Card"), app, [hoc("flow"), imported("@example/react-ds", "Card")]),
        row("App.tsx:29:6", pkg("Button"), app, [hoc("compose"), imported("@example/react-ds", "Button")]),
        // The in-file withB takes no import step.
        row("App.tsx:30:6", pkg("TextInput"), app, [hoc("withA"), hoc("withB"), imported("@example/react-ds", "TextInput")]),
      ]);
    });
  });

  describe("hoc-cross-module", () => {
    it("follows HOC products re-exported through a JavaScript barrel back to the wrapped component", () => {
      const S = "hoc-cross-module";
      const app = local(S, "App.tsx", "App");
      expect(rendersIn(S)).toEqual([
        row("App.tsx:6:6", local(S, "components.tsx", "Foo"), app, [
          imported("./index.js", "Foo"),
          hoc("flow"),
          imported("./components.tsx", "Foo"),
        ]),
        row("App.tsx:7:6", local(S, "components.tsx", "Bar"), app, [
          imported("./index.js", "Bar"),
          hoc("connect"),
          imported("./components.tsx", "Bar"),
        ]),
      ]);
    });
  });

  describe("composition-edge", () => {
    it("traces a memo product and a curried HOC product, directly and through a static map member", () => {
      const app = local("composition-edge", "App.tsx", "App");
      expect(rendersIn("composition-edge")).toEqual([
        row("App.tsx:13:6", pkg("Button"), app, [hoc("memo"), imported("@example/react-ds", "Button")]),
        row("App.tsx:14:6", pkg("TextInput"), app, [hoc("connect"), imported("@example/react-ds", "TextInput")]),
        row("App.tsx:15:6", pkg("Button"), app, [hoc("memo"), imported("@example/react-ds", "Button")]),
      ]);
    });
  });

  describe("react-builtin-wrappers", () => {
    const S = "react-builtin-wrappers";
    const declared = (name: string) => local(S, "App.tsx", name);
    // `Nested = memo(forwardRef(...))`: its two defects are the `it.fails` below.
    const nested = ["App.tsx:14:65", "App.tsx:26:6"];

    it("traces forwardRef and memo over same-file declarations with no import step for that file", () => {
      expect(
        out.occurrences.flatMap((o) => o.trace).filter((s) => isKind(s, "import") && s.specifier === `src/${S}/App.tsx`),
      ).toEqual([]);
      expect(rendersIn(S).filter((r) => !nested.includes(r.at))).toEqual([
        row("App.tsx:5:65", pkg("Button"), declared("FancyButton"), [imported("@example/react-ds", "Button")], {
          "...rest": { tier: "dynamic" },
        }),
        row("App.tsx:23:6", declared("FancyButton"), declared("App"), [hoc("forwardRef")]),
        row("App.tsx:24:6", pkg("TextInput"), declared("App"), [hoc("memo"), imported("@example/react-ds", "TextInput")]),
        row("App.tsx:25:6", pkg("Card"), declared("App"), [hoc("memo"), imported("@example/react-ds", "Card")]),
        row("Page.tsx:4:9", declared("Plain"), local(S, "Page.tsx", "Page"), [imported("./App", "default"), hoc("memo")]),
      ]);
    });

    it.fails("owns the render inside memo(forwardRef(...)) by the component it declares", () => {
      expect(rendersIn(S).find((r) => r.at === "App.tsx:14:65")).toEqual(
        row("App.tsx:14:65", pkg("TextInput"), declared("Nested"), [imported("@example/react-ds", "TextInput")], {
          "...rest": { tier: "dynamic" },
        }),
      );
    });

    it.fails("traces memo(forwardRef(...)) through both wrappers, with no import step for forwardRef", () => {
      expect(rendersIn(S).find((r) => r.at === "App.tsx:26:6")).toEqual(
        row("App.tsx:26:6", declared("Nested"), declared("App"), [hoc("memo"), hoc("forwardRef")]),
      );
    });
  });

  describe("esm-js-specifiers: `.js` specifier → `.tsx` source", () => {
    // Under `moduleResolution: nodenext` a relative specifier spells the
    // emitted `.js` extension while the source on disk is `.tsx`.
    it("resolves `./Leaf.js` and `./index.js` to their `.tsx` sources and emits the cross-file occurrences", () => {
      const S = "esm-js-specifiers";
      expect(rendersIn(S)).toEqual([
        row("A.tsx:5:23", local(S, "Leaf.tsx", "Leaf"), local(S, "A.tsx", "A"), [imported("./Leaf.js", "Leaf")]),
        row("B.tsx:4:23", local(S, "index.tsx", "Idx"), local(S, "B.tsx", "B"), [imported("./index.js", "Idx")]),
        row("Leaf.tsx:3:26", pkg("Button"), local(S, "Leaf.tsx", "Leaf"), [imported("@example/react-ds", "Button")]),
        row("index.tsx:3:25", pkg("Button"), local(S, "index.tsx", "Idx"), [imported("@example/react-ds", "Button")]),
      ]);
    });
  });

  describe("context", () => {
    it("credits nothing at a context's Provider, Consumer or React 19 provider, whatever its default", () => {
      const S = "context";
      const theme = (name: string) => local(S, "Theme.tsx", name);
      expect(rendersIn(S)).toEqual([
        row("Theme.tsx:23:4", theme("ThemeProvider"), theme("ThemedPage"), []),
        row("Theme.tsx:24:6", pkg("Card"), theme("ThemedPage"), [imported("@example/react-ds", "Card")], {}),
      ]);
      expect(diagnosticsIn(S)).toEqual([
        {
          code: "late-bound-render",
          severity: "info",
          filePath: `src/${S}/Theme.tsx`,
          line: 18,
          column: 49,
          symbol: "Theme",
          memberChain: [],
        },
      ]);
    });
  });

  describe("cjs-interop", () => {
    it("credits `'default' in X ? X.default : X` over a default import once, to the package's default export", () => {
      const S = "cjs-interop";
      expect(rendersIn(S)).toEqual([
        row("Interop.tsx:7:9", pkgOf("@example/design-system", "default"), local(S, "Interop.tsx", "Interop"), []),
      ]);
    });
  });

  describe("compound-roots", () => {
    it("names each member of an imported compound by its whole path, and reports a compound whose root is never bound", () => {
      const S = "compound-roots";
      const app = local(S, "App.tsx", "App");
      const tabs = [imported("@example/react-ds", "Tabs")];
      expect(rendersIn(S)).toEqual([
        row("App.tsx:5:4", pkg("Tabs.Root"), app, tabs),
        row("App.tsx:6:6", pkg("Tabs.Trigger"), app, tabs, { value: { tier: "written", value: "a" } }),
        row(
          "App.tsx:15:4",
          { status: "unresolved", reason: { kind: "unbound-name", name: "Disclosure" } },
          local(S, "App.tsx", "Sidebar"),
          [],
        ),
      ]);
      expect(componentOf(pkg("Tabs")), "the compound `Tabs` gets no row of its own").toBeUndefined();
    });
  });

  describe("deep-compound", () => {
    it("names a compound member two levels deep by its whole path", () => {
      const S = "deep-compound";
      const menus = local(S, "Menus.tsx", "Menus");
      expect(rendersIn(S)).toEqual([
        // The namespace import's name is not part of the member's identity.
        row("Menus.tsx:10:6", pkg("Toast.Title"), menus, [imported("@example/react-ds", "*")]),
        row("Menus.tsx:11:6", local(S, "Menus.tsx", "Nav.Menu.Item"), menus, []),
      ]);
    });
  });

  describe("nesting", () => {
    it("owns each element nested inside other elements by the component that renders it", () => {
      const S = "nesting";
      const panel = local(S, "Panel.tsx", "Panel");
      const leaf = (name: string) => [imported("@example/react-ds", name)];
      expect(rendersIn(S)).toEqual([
        row("Panel.tsx:6:4", pkg("Card"), panel, leaf("Card")),
        row("Panel.tsx:7:6", pkg("Button"), panel, leaf("Button"), {}),
        row("Panel.tsx:8:8", pkg("TextInput"), panel, leaf("TextInput"), {}),
        row("Panel.tsx:10:6", pkg("TextInput"), panel, leaf("TextInput"), {}),
      ]);
    });
  });

  describe("hoc-rescue", () => {
    it("credits memo over a component that renders nothing, where it renders and where a factory receives it", () => {
      const S = "hoc-rescue";
      const slot = (name: string) => local(S, "Slot.tsx", name);
      expect(rendersIn(S)).toEqual([
        row("Slot.tsx:10:31", slot("Quiet"), slot("Slot"), [hoc("memo")], {}, {
          credit: { kind: "argument", callee: "createSlot", index: 0 },
        }),
        row("Slot.tsx:15:6", slot("Slot"), slot("SlotPage"), []),
        row("Slot.tsx:16:6", slot("Quiet"), slot("SlotPage"), [hoc("memo")]),
      ]);
      expect(diagnosticsIn(S)).toEqual([
        {
          code: "late-bound-render",
          severity: "info",
          filePath: `src/${S}/Slot.tsx`,
          line: 8,
          column: 15,
          symbol: "C",
          memberChain: [],
        },
      ]);
    });
  });

  describe("data-method", () => {
    it("never credits a callback handed to a data method, and reports the render it can't follow", () => {
      const S = "data-method";
      expect(rendersIn(S)).toEqual([]);
      expect(diagnosticsIn(S)).toEqual([
        {
          code: "unresolved-reference",
          severity: "info",
          filePath: `src/${S}/Picker.tsx`,
          line: 8,
          column: 9,
          symbol: "Shown",
          memberChain: [],
        },
      ]);
    });
  });

  describe("pass-through", () => {
    it("keeps the hoc step for a wrapper that hands back its component through local aliases", () => {
      const S = "pass-through";
      expect(rendersIn(S)).toEqual([
        row("Wrapped.tsx:14:9", pkg("Card"), local(S, "Wrapped.tsx", "Wrapped"), [
          hoc("withAlias"),
          imported("@example/react-ds", "Card"),
        ]),
      ]);
    });
  });

  describe("helper-fanout-data-factory", () => {
    it("credits the element a helper builds to each component that calls it, through a helper-call step", () => {
      const S = "helper-fanout-data-factory";
      const leaf = local(S, "Leaf.tsx", "Leaf");
      const viewA = local(S, "ViewA.tsx", "ViewA");
      const viewB = local(S, "ViewB.tsx", "ViewB");
      const trace = [helperCall(S, "config.tsx", "getRows"), imported("./Leaf", "Leaf")];
      expect(rendersIn(S)).toEqual([row("config.tsx:6:9", leaf, viewA, trace), row("config.tsx:6:9", leaf, viewB, trace)]);
      expect(componentOf(leaf)?.composition.renderedByCount).toEqual({ [idOf(viewA)]: 1, [idOf(viewB)]: 1 });
    });
  });

  describe("helper-fanout-hook", () => {
    it("credits the element a hook builds to the component that calls the hook", () => {
      const S = "helper-fanout-hook";
      const cta = local(S, "Cta.tsx", "Cta");
      const panel = local(S, "Panel.tsx", "Panel");
      expect(rendersIn(S)).toEqual([
        row("useOptions.tsx:6:16", cta, panel, [helperCall(S, "useOptions.tsx", "useOptions"), imported("./Cta", "Cta")]),
      ]);
      expect(componentOf(cta)?.composition.renderedByCount).toEqual({ [idOf(panel)]: 1 });
    });
  });

  describe("helper-chain-three-hops", () => {
    it("credits an element three helpers deep to the component at the top of the chain", () => {
      const S = "helper-chain-three-hops";
      const inner = local(S, "Inner.tsx", "Inner");
      const view = local(S, "View.tsx", "View");
      // resolveOwnerChain prepends the helper-call hop at each recursion level,
      // unwinding so the innermost helper (helperC) appears first in the trace
      // and the outermost (helperA, called by View) appears last.
      expect(rendersIn(S)).toEqual([
        row("helpers.tsx:3:45", inner, view, [
          helperCall(S, "helpers.tsx", "helperC"),
          helperCall(S, "helpers.tsx", "helperB"),
          helperCall(S, "helpers.tsx", "helperA"),
          imported("./Inner", "Inner"),
        ]),
      ]);
      expect(componentOf(inner)?.composition.renderedByCount).toEqual({ [idOf(view)]: 1 });
    });
  });

  describe("helper-orphan-no-caller", () => {
    it("credits the element a helper nothing calls with no owner, as a root render", () => {
      const S = "helper-orphan-no-caller";
      const leaf = local(S, "Leaf.tsx", "Leaf");
      expect(rendersIn(S)).toEqual([
        row("unused.tsx:4:47", leaf, undefined, [helperCall(S, "unused.tsx", "buildRows"), imported("./Leaf", "Leaf")]),
      ]);
      expect(componentOf(leaf)?.composition.isRootCount).toBe(1);
      expect(componentOf(leaf)?.composition.renderedByCount).toEqual({});
    });
  });

  describe("helper-cycle", () => {
    it("reports a render inside two helpers that call each other with no owner, and credits a direct render normally", () => {
      const S = "helper-cycle";
      const leaf = local(S, "cycle.tsx", "Leaf");
      const view = local(S, "cycle.tsx", "View");
      const call = (callee: string) => helperCall(S, "cycle.tsx", callee);
      expect(rendersIn(S)).toEqual([
        row("cycle.tsx:6:38", leaf, undefined, [call("helperA"), call("helperB"), call("helperA")]),
        row("cycle.tsx:11:31", leaf, view, [], {}),
      ]);
      expect(componentOf(leaf)?.composition.renderedByCount).toEqual({ [idOf(view)]: 1 });
    });
  });

  describe("helper-cross-file-import", () => {
    it("credits the element an imported helper builds to the component that calls it", () => {
      const S = "helper-cross-file-import";
      const leaf = local(S, "Leaf.tsx", "Leaf");
      const view = local(S, "View.tsx", "View");
      expect(rendersIn(S)).toEqual([
        row("utils.tsx:3:45", leaf, view, [helperCall(S, "utils.tsx", "getRows"), imported("./Leaf", "Leaf")]),
      ]);
      expect(componentOf(leaf)?.composition.renderedByCount).toEqual({ [idOf(view)]: 1 });
    });
  });

  describe("helper-multi-caller-mixed", () => {
    it("credits a helper's element to a direct caller and to a caller through a second helper", () => {
      const S = "helper-multi-caller-mixed";
      const leaf = local(S, "Leaf.tsx", "Leaf");
      const viewA = local(S, "Views.tsx", "ViewA");
      const viewB = local(S, "Views.tsx", "ViewB");
      expect(rendersIn(S)).toEqual([
        row("build.tsx:4:43", leaf, viewA, [helperCall(S, "build.tsx", "build"), imported("./Leaf", "Leaf")]),
        row("build.tsx:4:43", leaf, viewB, [
          helperCall(S, "build.tsx", "build"),
          helperCall(S, "wrap.tsx", "wrap"),
          imported("./Leaf", "Leaf"),
        ]),
      ]);
      expect(componentOf(leaf)?.composition.renderedByCount).toEqual({ [idOf(viewA)]: 1, [idOf(viewB)]: 1 });
    });
  });

  describe("helper-jsx-call-of-helper", () => {
    // `List = ({ items }) => items.map((it) => <Item .../>)` is a component,
    // not a helper: `<List/>` in Page is a direct render. List is its own
    // component row, rendered by Page; Item is rendered by List directly, with
    // no `helper-call` hop in between.
    it("treats a component that maps its items to elements as a component, not a helper", () => {
      const S = "helper-jsx-call-of-helper";
      const list = local(S, "List.tsx", "List");
      const page = local(S, "Page.tsx", "Page");
      expect(rendersIn(S)).toEqual([
        row("List.tsx:8:20", local(S, "Item.tsx", "Item"), list, [imported("./Item", "Item")], {
          key: { tier: "reference", ref: "it.id" },
        }),
        row("Page.tsx:5:26", list, page, [imported("./List", "List")], { items: { tier: "reference", ref: "data" } }),
      ]);
      expect(componentOf(list)?.usage).toBe("direct");
      expect(componentOf(list)?.composition.renderedByCount).toEqual({ [idOf(page)]: 1 });
    });
  });

  describe("helper-prop-forward-interaction", () => {
    it("credits a module-scope element passed as a prop to the component that passes it, through a prop-forward step", () => {
      const S = "helper-prop-forward-interaction";
      const notification = local(S, "Notification.tsx", "Notification");
      const consumer = local(S, "Consumer.tsx", "Consumer");
      expect(rendersIn(S)).toEqual([
        row("Consumer.tsx:6:13", notification, consumer, [propForward(S, "Consumer.tsx", "slot", 6, 6)]),
        row("Consumer.tsx:8:30", local(S, "Page.tsx", "Page"), consumer, [imported("./Page", "Page")], {
          slot: { tier: "reference", ref: "slot" },
        }),
      ]);
      expect(componentOf(notification)?.composition.renderedByCount).toEqual({ [idOf(consumer)]: 1 });
    });
  });

  describe("prop-forward-repeat-read", () => {
    it("emits one occurrence, owned by C, for a module-scope element C forwards twice", () => {
      const S = "prop-forward-repeat-read";
      const icon = local(S, "Icon.tsx", "Icon");
      const c = local(S, "C.tsx", "C");
      expect(rendersIn(S)).toEqual([
        row("C.tsx:5:13", icon, c, [propForward(S, "C.tsx", "icon", 5, 6)]),
        row("C.tsx:8:4", local(S, "A.tsx", "A"), c, [imported("./A", "A")], { x: { tier: "reference", ref: "icon" } }),
        row("C.tsx:9:4", local(S, "B.tsx", "B"), c, [imported("./B", "B")], { y: { tier: "reference", ref: "icon" } }),
      ]);
      expect(componentOf(icon)?.composition.renderedByCount).toEqual({ [idOf(c)]: 1 });
    });
  });

  // The repository declares and installs the `@example/design-system` stand-in;
  // `ds-icons` is neither declared nor installed.
  describe("hoc-factory-products: wrapper factories, their products and the arguments they wrap", () => {
    const S = "hoc-factory-products";
    const declared = (file: string, name: string) => componentIn(S, name, file);

    it("credits each product where it renders, and what each factory wraps at its argument site", () => {
      const at = (file: string, name: string) => local(S, file, name);
      const app = at("app.jsx", "App");
      const argument = (callee: string) => ({ credit: { kind: "argument", callee, index: 0 } });
      const spinner = { status: "unresolved", reason: { kind: "module-not-found" } };
      const spinnerTrace = [helperCall(S, "with-loading.jsx", "withLoading"), imported("ds-icons", "Spinner")];
      expect(rendersIn(S)).toEqual([
        row("app.jsx:9:23", at("dropdown-control.js", "Dropdown"), app, [imported("./dropdown-control.js", "Dropdown")], {
          name: { tier: "written", value: "a" },
        }),
        row("app.jsx:9:44", at("signup-form.jsx", "default"), app, [imported("./signup-form.jsx", "default")], {
          title: { tier: "written", value: "t" },
        }),
        row("app.jsx:9:68", at("products.jsx", "Foo"), app, [imported("./products.jsx", "Foo")], {}),
        row("app.jsx:9:75", at("products.jsx", "Bar"), app, [imported("./products.jsx", "Bar")], {}),
        row("app.jsx:9:82", at("junk.jsx", "Junk"), app, [imported("./junk.jsx", "Junk")], {}),
        row("app.jsx:9:90", at("pennant.jsx", "PennantView"), app, [imported("./pennant.jsx", "Pennant"), hoc("forwardRef")], {
          label: { tier: "written", value: "p" },
        }),
        row("app.jsx:9:111", at("marquee.jsx", "MarqueeView"), app, [imported("./marquee.jsx", "Marquee")], {}),
        row("app.jsx:9:122", at("swatch.jsx", "Gallery"), app, [imported("./swatch.jsx", "Gallery")], {}),
        row("app.jsx:9:133", at("swatch.jsx", "SwatchImpl"), app, [imported("./swatch.jsx", "Swatch")], {}),
        row(
          "dropdown-control.js:3:29",
          pkgOf("@example/design-system", "Dropdown"),
          at("dropdown-control.js", "Dropdown"),
          [imported("@example/design-system", "Dropdown")],
          {},
          argument("makeControl"),
        ),
        // The nested `Tessera` has the same file and name as the exported one, so
        // it shares that identity.
        row("mosaic.jsx:3:81", at("mosaic.jsx", "Tessera"), at("mosaic.jsx", "Mosaic"), [], { inner: { tier: "written", value: "x" } }),
        row("products.jsx:5:31", at("products.jsx", "FooView"), at("products.jsx", "Foo"), [], {}, argument("withLoading")),
        row("products.jsx:6:31", at("products.jsx", "BarView"), at("products.jsx", "Bar"), [], {}, argument("withLoading")),
        row("signup-form.jsx:4:47", at("signup-form.jsx", "SignupForm"), at("signup-form.jsx", "default"), [], {}, argument("withErrorBoundary")),
        row("swatch.jsx:3:63", at("swatch.jsx", "Swatch"), at("swatch.jsx", "Gallery"), []),
        // JSX inside a factory body is credited to each product; `<Spinner />` is unresolved.
        row("with-loading.jsx:3:62", spinner, at("products.jsx", "Foo"), spinnerTrace),
        row("with-loading.jsx:3:62", spinner, at("products.jsx", "Bar"), spinnerTrace),
      ]);
      const lateBound = (file: string, line: number, column: number, symbol: string) => ({
        code: "late-bound-render",
        severity: "info",
        filePath: `src/${S}/${file}`,
        line,
        column,
        symbol,
        memberChain: [],
      });
      expect(diagnosticsIn(S)).toEqual([
        lateBound("with-error-boundary.jsx", 3, 36, "Child"),
        lateBound("with-loading.jsx", 3, 76, "C"),
        lateBound("make-control.jsx", 4, 9, "Component"),
      ]);
    });

    it("links each wrapped default export and product to what it wraps", () => {
      const def = declared("signup-form.jsx", "default");
      const signupForm = declared("signup-form.jsx", "SignupForm");
      expect(signupForm?.composition.renderedByCount[def?.id ?? ""]).toBe(1);
      expect(def?.composition.rendersByCount[signupForm?.id ?? ""]).toBe(1);
      expect(declared("products.jsx", "Foo")?.composition.rendersByCount[declared("products.jsx", "FooView")?.id ?? ""]).toBe(1);

      const dropdown = declared("dropdown-control.js", "Dropdown");
      const dsDropdown = componentOf(pkgOf("@example/design-system", "Dropdown"));
      expect(dsDropdown?.composition.renderedByCount).toEqual({ [dropdown?.id ?? ""]: 1 });
      expect(dropdown?.composition.rendersByCount[dsDropdown?.id ?? ""]).toBe(1);
    });

    it("factories are never components", () => {
      expect(declared("make-control.jsx", "makeControl")).toBeUndefined();
      expect(declared("with-error-boundary.jsx", "withErrorBoundary")).toBeUndefined();
      expect(declared("with-loading.jsx", "withLoading")).toBeUndefined();
    });

    it("a credited declaration outside the roster still has its own definition", () => {
      const pennant = declared("pennant.jsx", "PennantView");
      expect(pennant).toBeDefined();
      expect(occurrencesOf(pennant?.id)).toHaveLength(1);
      expect(pennant?.definition).toEqual({ line: 4, column: 6 });

      const marquee = declared("marquee.jsx", "MarqueeView");
      expect(marquee).toBeDefined();
      expect(occurrencesOf(marquee?.id)).toHaveLength(1);
      expect(marquee?.definition).toEqual({ line: 4, column: 6 });
    });

    it("a row takes the declared props of its own declaration, whether or not anything exports it", () => {
      expect(declared("signup-form.jsx", "SignupForm")?.declared).toEqual({ props: { title: {} }, hasRest: false });
      expect(declared("pennant.jsx", "PennantView")?.declared).toEqual({ props: { label: {} }, hasRest: false });
    });

    it("an export alias keeps its own declaration's definition when a nested declaration shares the alias name", () => {
      const exported = declared("swatch.jsx", "SwatchImpl");
      expect(exported).toBeDefined();
      expect(exported?.definition).toEqual({ line: 4, column: 6 });

      const nested = declared("swatch.jsx", "Swatch");
      expect(nested).toBeDefined();
      expect(nested?.definition).toEqual({ line: 3, column: 34 });
    });

    it("a component whose name a nested declaration used first keeps its own definition and declared props", () => {
      const tessera = declared("mosaic.jsx", "Tessera");
      expect(tessera).toBeDefined();
      expect(tessera?.definition).toEqual({ line: 4, column: 13 });
      expect(tessera?.declared).toEqual({ props: { outer: {} }, hasRest: false });
    });

    it("no phantom externals and no non-components", () => {
      expect(out.components.filter((c) => c.identity.kind === "package-export" && !c.identity.packageName)).toEqual([]);
      for (const name of ["Component", "Child", "br", "renderIcon", "ApiClient"]) {
        expect(localExports(S), name).not.toContain(name);
        expect(
          out.components.find((c) => c.identity.kind === "package-export" && c.identity.exportName === name),
          name,
        ).toBeUndefined();
      }
    });
  });

  // `Button` and `Card` come from the `@example/owner-edges` stand-in, an installed
  // package that exports nothing the scanner can read.
  describe("owner-edges", () => {
    it("owns each render by its named, memo-wrapped or anonymous default component", () => {
      const S = "owner-edges";
      const page = local(S, "Page.tsx", "Page");
      const footer = local(S, "Page.tsx", "Footer");
      const anonymous = local(S, "Page.tsx", "default");
      const button = pkgOf("@example/owner-edges", "Button");
      const card = pkgOf("@example/owner-edges", "Card");
      const leaf = (name: string) => [imported("@example/owner-edges", name)];
      expect(rendersIn(S)).toEqual([
        row("Page.tsx:6:4", card, page, leaf("Card")),
        row("Page.tsx:7:6", button, page, leaf("Button"), { variant: { tier: "written", value: "primary" } }),
        row("Page.tsx:12:33", button, footer, leaf("Button"), { variant: { tier: "written", value: "ghost" } }),
        row("Page.tsx:15:9", button, anonymous, leaf("Button")),
      ]);
      expect(componentOf(page)?.definition).toEqual({ line: 4, column: 7 });
      expect(componentOf(page)?.composition.rendersByCount).toEqual({ [idOf(card)]: 1, [idOf(button)]: 1 });
      expect(componentOf(footer)?.composition.rendersByCount).toEqual({ [idOf(button)]: 1 });
      expect(componentOf(anonymous)?.composition.rendersByCount).toEqual({ [idOf(button)]: 1 });
    });
  });

  describe("default-rewrap-barrel: barrel re-wrap of an imported local", () => {
    it("credits a component a barrel re-exports, by default or by name, to the file that declares it", () => {
      const S = "default-rewrap-barrel";
      const app = local(S, "App.jsx", "App");
      const seo = local(S, "seo/seo.jsx", "Seo");
      const widget = local(S, "widget/widget.jsx", "Widget");
      expect(rendersIn(S)).toEqual([
        row("App.jsx:7:6", seo, app, [imported("./seo", "default")]),
        row("App.jsx:8:6", widget, app, [imported("./widget", "Widget")]),
      ]);
      expect(componentOf(seo)?.composition.renderedByCount).toEqual({ [idOf(app)]: 1 });
      expect(componentOf(widget)?.composition.renderedByCount).toEqual({ [idOf(app)]: 1 });
    });
  });

  describe("prop-forward-hoc-owner", () => {
    it("owns a module-scope element by the component a memo or React.forwardRef call declares", () => {
      const S = "prop-forward-hoc-owner";
      expect(rendersIn(S)).toEqual([
        row("Badges.tsx:4:15", pkg("Button"), local(S, "Badges.tsx", "MemoBadge"), [propForward(S, "Badges.tsx", "action", 4, 6)]),
        row("Badges.tsx:5:14", pkg("Card"), local(S, "Badges.tsx", "RefBadge"), [propForward(S, "Badges.tsx", "frame", 5, 6)]),
      ]);
    });
  });

  describe("prop-forward-shadowed", () => {
    it("owns a module-scope element by the component that reads it, not one whose parameter default reuses its name", () => {
      const S = "prop-forward-shadowed";
      expect(rendersIn(S)).toEqual([
        row("Tiles.tsx:3:13", pkg("Button"), local(S, "Tiles.tsx", "Toolbar"), [propForward(S, "Tiles.tsx", "icon", 3, 6)]),
      ]);
    });
  });
});
