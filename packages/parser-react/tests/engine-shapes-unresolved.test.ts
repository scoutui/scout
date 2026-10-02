import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { idsOf, relResolver, scan, pathResolver } from "./shape-helpers.js";

const root = "/repo";
const reasons = (occs: ReturnType<typeof scan>) => occs.filter((o) => o.unresolved).map((o) => o.unresolved);

describe("unresolved renders stay observed", () => {
  it("reports a declared but uninstalled package as package-not-installed", () => {
    const occs = scan(
      { "/repo/src/App.tsx": `import { Button } from "@example/ui"; export const App = () => <Button kind="a" />;` },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: () => true },
    );
    expect(reasons(occs)).toEqual([{ kind: "package-not-installed", packageName: "@example/ui" }]);
    expect(occs.filter((o) => o.rawComponentId)).toEqual([]);
    expect(occs[0]?.props).toHaveProperty("kind");
  });

  it("keeps the written-package identity when the package is installed but its module did not resolve", () => {
    const occs = scan(
      { "/repo/src/App.tsx": `import Link from "@example/ui/dist/link"; export const App = () => <Link />;` },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: () => true, isInstalledPackage: () => true },
    );
    expect(reasons(occs)).toEqual([]);
    expect(idsOf(occs)).toMatchObject([{ package: "@example/ui", export: "default" }]);
  });

  it("reports an undeclared bare package as module-not-found", () => {
    const occs = scan(
      { "/repo/src/App.tsx": `import { Button } from "left-pad-ui"; export const App = () => <Button />;` },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: () => false },
    );
    expect(reasons(occs)).toEqual([{ kind: "module-not-found" }]);
  });

  it("never invents a package for an unconfigured alias", () => {
    const occs = scan(
      { "/repo/src/App.tsx": `import { Button } from "@/components/Button"; export const App = () => <Button />;` },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: () => true },
    );
    expect(reasons(occs)).toEqual([{ kind: "module-not-found" }]);
  });

  it("reports an unbound PascalCase render as unbound-name", () => {
    const occs = scan({ "/repo/src/App.tsx": "export const App = () => <Missing />;" }, pathResolver(root), root, {});
    expect(reasons(occs)).toEqual([{ kind: "unbound-name", name: "Missing" }]);
  });

  it.each([
    ["a memo fold", `import { memo } from "react"; import { Button } from "@example/ui"; const B = memo(Button); export const App = () => <B />;`, ["local-component", "hoc-wrapper"]],
    ["an alias", `import { Button } from "@example/ui"; const B = Button; export const App = () => <B />;`, ["local-component"]],
  ])("reports a declared but uninstalled package reached through %s as a render, keeping the fold's hops", (_label, app, hops) => {
    const occs = scan({ "/repo/src/App.tsx": app }, pathResolver(root), root, {}, { isDeclaredDependency: () => true });
    expect(occs.map((o) => [o.unresolved, o.unresolved && o.writtenRef, o.viaChain.map((v) => v.kind)])).toEqual([
      [{ kind: "package-not-installed", packageName: "@example/ui" }, "@example/ui#Button", hops],
    ]);
  });

  it("reports a lazy import of an uninstalled package as a render through its lazy hop", () => {
    const occs = scan(
      { "/repo/src/App.tsx": `import { lazy } from "react"; const L = lazy(() => import("@example/ui/Card")); export const App = () => <L />;` },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: () => true },
    );
    expect(occs.map((o) => [o.unresolved, o.unresolved && o.writtenRef, o.viaChain.map((v) => v.kind)])).toEqual([
      [{ kind: "package-not-installed", packageName: "@example/ui" }, "@example/ui/Card#default", ["local-component", "lazy-import"]],
    ]);
  });

  it("reports an uninstalled package passed to a hook as an argument site", () => {
    const occs = scan(
      {
        "/repo/src/App.tsx": `import { useModal } from "@example/modal"; import { Dialog } from "@example/ui";
export function App() { const m = useModal(Dialog); return <div />; }`,
      },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: (_from, name) => name === "@example/ui" },
    );
    expect(occs.map((o) => [o.unresolved, o.viaChain[0]?.kind, (o.rawOwnerComponentId as { export?: string } | undefined)?.export])).toEqual([
      [{ kind: "package-not-installed", packageName: "@example/ui" }, "passed-as-argument", "App"],
    ]);
  });

  it("credits an uninstalled package passed to a hook once, at the render of the hook's product", () => {
    const occs = scan(
      {
        "/repo/src/App.tsx": `import { useStyled } from "@example/styled"; import { Dialog } from "@example/ui";
export function App() { const C = useStyled(Dialog); return <C />; }`,
      },
      pathResolver(root),
      root,
      {},
      { isDeclaredDependency: (_from, name) => name === "@example/ui" },
    );
    expect(occs.map((o) => [o.unresolved, o.unresolved && o.writtenRef, o.viaChain.map((v) => v.kind), (o.rawOwnerComponentId as { export?: string } | undefined)?.export])).toEqual([
      [{ kind: "package-not-installed", packageName: "@example/ui" }, "@example/ui#Dialog", ["local-component", "hoc-wrapper"], "App"],
    ]);
  });

  it.each([
    ["a missing relative module", `export { X } from "./missing";`],
    ["an unconfigured alias", `export { X } from "@/unconfigured/x";`],
    ["an import of a missing relative module", `import { X } from "./missing";\nexport { X };`],
  ])("reports a barrel re-export of %s as module-not-found at the render, with no diagnostic", (_label, barrel) => {
    const collector = createDiagnosticCollector();
    const occs = scan(
      { "src/barrel.tsx": barrel, "src/App.tsx": `import { X } from "./barrel";\nexport const App = () => <X />;` },
      relResolver(root),
      root,
      { collector },
    );
    expect(occs.map((o) => [o.filePath, o.unresolved, o.unresolved && o.writtenRef])).toEqual([
      ["src/App.tsx", { kind: "module-not-found" }, "./barrel#X"],
    ]);
    expect(collector.drain()).toEqual([]);
  });

  it("reports a failed relative import as module-not-found", () => {
    const occs = scan(
      { "/repo/src/App.tsx": `import { Gone } from "./Gone"; export const App = () => <Gone />;` },
      () => null,
      root,
      {},
    );
    expect(reasons(occs)).toEqual([{ kind: "module-not-found" }]);
  });
});
