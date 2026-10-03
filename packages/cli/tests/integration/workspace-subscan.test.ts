import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isKind, type Component, type ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { assertValidArtifact } from "../helpers/artifact.js";
import { stageFixture } from "../helpers/stage-fixture.js";

const CLI = resolve(import.meta.dirname, "..", "..", "dist", "cli.js");

/** Stages workspace-subscan with `extraFiles` written over it and `@ws-sub/ui` linked into `node_modules`, as Yarn links a workspace package. */
async function stageLinked(extraFiles: Record<string, string> = {}): Promise<string> {
  const stage = await stageFixture("workspace-subscan");
  for (const [rel, content] of Object.entries(extraFiles)) {
    writeFileSync(join(stage, rel), content);
  }
  mkdirSync(join(stage, "node_modules", "@ws-sub"), { recursive: true });
  symlinkSync(join(stage, "packages", "ui"), join(stage, "node_modules", "@ws-sub", "ui"), "dir");
  return stage;
}

function scan(cwd: string): ScanArtifact<Diagnostic> {
  execFileSync("node", [CLI, "scan", "--quiet", "--dry-run"], {
    cwd,
    stdio: "pipe",
  });
  return assertValidArtifact(JSON.parse(readFileSync(join(cwd, "scout-scan.json"), "utf8")));
}

const findButton = (o: ScanArtifact): Component => {
  const button = o.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Button");
  if (button === undefined) throw new Error("no Button component");
  return button;
};

/** The declaring file of a repository declaration. */
const fileOf = (c: Component | undefined) => (c?.identity.kind === "repository-declaration" ? c.identity.filePath : undefined);

describe("integration: sub-package scan of a monorepo", () => {
  let stageA: string; // scanned from workspace root
  let stageB: string; // scanned from apps/web only
  let rootOut: ScanArtifact;
  let subOut: ScanArtifact;

  beforeAll(async () => {
    stageA = await stageLinked();
    stageB = await stageLinked();
    rootOut = scan(stageA);
    subOut = scan(join(stageB, "apps", "web"));
  });

  afterAll(() => {
    rmSync(stageA, { recursive: true, force: true });
    rmSync(stageB, { recursive: true, force: true });
  });

  it("sub scan: sibling Button is local with correct owner package", () => {
    const button = findButton(subOut);
    expect(button).toBeDefined();
    expect(button.identity.kind).toBe("repository-declaration");
    expect(button.owningPackage).toBe("@ws-sub/ui");
  });

  it("sub scan: identity pinned to the definition file, not the barrel", () => {
    expect(fileOf(findButton(subOut))).toBe(
      "packages/ui/src/button.tsx",
    );
  });

  it("sub scan: the un-walked sibling Button is defined where the root scan finds it", () => {
    expect(findButton(rootOut).definition).toEqual({ line: 1, column: 7 });
    expect(findButton(subOut).definition).toEqual(findButton(rootOut).definition);
  });

  it("sub scan: an un-walked sibling passed only as a hook argument is defined where it is declared", () => {
    const badge = subOut.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Badge");
    expect([fileOf(badge), badge?.definition]).toEqual(["packages/ui/src/badge.tsx", { line: 1, column: 7 }]);
  });

  it("sub scan: static members of an un-walked sibling, rendered directly or destructured, are defined at their assignments", () => {
    const member = (name: string) =>
      subOut.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === name);
    expect([fileOf(member("Table.Row")), member("Table.Row")?.definition]).toEqual([
      "packages/ui/src/table.tsx",
      { line: 13, column: 0 },
    ]);
    expect([fileOf(member("Table.Cell")), member("Table.Cell")?.definition]).toEqual([
      "packages/ui/src/table.tsx",
      { line: 14, column: 0 },
    ]);
  });

  it("sub scan: a component the sibling's barrel imports and then exports is defined in its own file", () => {
    const chipOf = (o: ScanArtifact) =>
      o.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Chip");
    expect([fileOf(chipOf(subOut)), chipOf(subOut)?.definition]).toEqual(["packages/ui/src/chip.tsx", { line: 1, column: 7 }]);
    expect(chipOf(subOut)?.id).toBe(chipOf(rootOut)?.id);
  });

  it("root scan: a member of a namespace the sibling's barrel re-exports with `export * as` is the component its file declares", () => {
    const occ = rootOut.occurrences.find((o) => o.filePath === "apps/web/src/App.tsx" && o.line === 15);
    const field = rootOut.components.find((c) => c.id === occ?.resolution.componentId);
    expect([field?.identity, field?.definition]).toEqual([
      { kind: "repository-declaration", repoId: "workspace-subscan", filePath: "packages/ui/src/forms.tsx", exportName: "Field" },
      { line: 1, column: 7 },
    ]);
  });

  it.fails("root and sub scans give the component rendered as <Table.Row /> the same id and name", () => {
    const tableRowOf = (o: ScanArtifact) => {
      const occ = o.occurrences.find((x) => x.filePath === "apps/web/src/App.tsx" && x.line === 13);
      const row = o.components.find((c) => c.id === occ?.resolution.componentId);
      return row?.identity.kind === "repository-declaration" ? { id: row.id, name: row.identity.exportName } : undefined;
    };
    expect(tableRowOf(subOut)).toEqual(tableRowOf(rootOut));
  });

  it("sub scan: occurrence paths are git-root-relative", () => {
    const occ = subOut.occurrences.find(
      (o) => o.resolution.componentId === findButton(subOut).id,
    );
    expect(occ?.filePath).toBe("apps/web/src/App.tsx");
  });

  it("identity is scope-invariant: root scan and sub scan agree on Button's id", () => {
    expect(fileOf(findButton(rootOut))).toBe(
      "packages/ui/src/button.tsx",
    );
    expect(findButton(subOut).id).toBe(findButton(rootOut).id);
  });

  it("sub scan: un-walked sibling carries the consumer occurrence but empty composition", () => {
    const button = findButton(subOut);
    expect(button.stats.occurrenceCount).toBe(1);
    expect(Object.keys(button.composition?.rendersByCount ?? {})).toHaveLength(
      0,
    );
  });

  // The sub scan's workspace root (stage root) differs from the scan
  // dir (apps/web); relative-import references must still resolve and keep
  // their occurrences.
  it("sub scan: relative-import local component keeps its occurrence", () => {
    const card = subOut.components.find(
      (c) => c.identity.kind !== "tag" && c.identity.exportName === "Card",
    );
    expect(card).toBeDefined();
    const occ = subOut.occurrences.find((o) => o.resolution.componentId === card?.id);
    expect(occ).toBeDefined();
    expect(occ?.filePath).toBe("apps/web/src/App.tsx");
    expect(occ?.credit.kind).toBe("render");
    expect(occ?.trace.map((t) => t.kind)).toEqual(["import"]);
  });

  it("relative-import local identity is scope-invariant between root and sub scan", () => {
    const cardOf = (o: ScanArtifact) =>
      o.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Card");
    expect(fileOf(cardOf(rootOut))).toBe("apps/web/src/card.tsx");
    expect(cardOf(subOut)?.id).toBe(cardOf(rootOut)?.id);
  });

  it("no phantom external component for the sibling package", () => {
    expect(
      subOut.components.some(
        (c) =>
          c.identity.kind === "package-export" &&
          c.identity.packageName === "@ws-sub/ui",
      ),
    ).toBe(false);
  });
});

describe("integration: a sibling's static member passed only as a hook argument", () => {
  let stage: string;
  let out: ScanArtifact<Diagnostic>;

  beforeAll(async () => {
    stage = await stageLinked({
      "apps/web/src/App.tsx": [
        'import { Table, useSlot } from "@ws-sub/ui";',
        "",
        "const { Cell } = Table;",
        "",
        "export function App() {",
        "  useSlot(Cell);",
        "  return <main />;",
        "}",
        "",
      ].join("\n"),
    });
    out = scan(join(stage, "apps", "web"));
  });

  afterAll(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it("sub scan: the destructured member is defined at its assignment in the sibling's file", () => {
    const cell = out.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Table.Cell");
    expect([fileOf(cell), cell?.definition]).toEqual(["packages/ui/src/table.tsx", { line: 14, column: 0 }]);
  });
});

describe("integration: a CommonJS sibling file imported by relative path", () => {
  let stage: string;
  let out: ScanArtifact<Diagnostic>;

  beforeAll(async () => {
    stage = await stageLinked({
      "packages/ui/src/legacy.jsx": "function Legacy(){return <span/>}; module.exports = { Legacy };\n",
      "apps/web/src/App.tsx": [
        'import { Legacy } from "../../../packages/ui/src/legacy.jsx";',
        "",
        "export function App() {",
        "  return <Legacy />;",
        "}",
        "",
      ].join("\n"),
    });
    out = scan(join(stage, "apps", "web"));
  });

  afterAll(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it("sub scan: the component is defined where the sibling file declares it", () => {
    const legacy = out.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Legacy");
    expect([fileOf(legacy), legacy?.definition]).toEqual(["packages/ui/src/legacy.jsx", { line: 1, column: 0 }]);
  });
});

describe("integration: diagnostic paths in a sub-package scan", () => {
  let stage: string;
  let out: ScanArtifact<Diagnostic>;

  beforeAll(async () => {
    stage = await stageLinked({
      "apps/web/src/haunted.tsx": [
        'import { Card } from "./card";',
        "",
        "export function Haunted({ Slot }) {",
        "  return (",
        "    <div>",
        '      <Card title="boo" />',
        "      <Ghost />",
        "      <Slot />",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "apps/web/src/traced.tsx": [
        'import { Card } from "./card";',
        "",
        'const slot = <Card title="slot" />;',
        "const panels = { card: Card };",
        "",
        "function renderCard() {",
        '  return <Card title="helper" />;',
        "}",
        "",
        "export function Traced({ kind }) {",
        "  const Panel = panels[kind];",
        "  return (",
        "    <div>",
        "      {slot}",
        "      <Panel />",
        "      {renderCard()}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "apps/web/src/dup-a.tsx": [
        "class DupA extends HTMLElement {}",
        'customElements.define("x-dup", DupA);',
        "",
      ].join("\n"),
      "apps/web/src/dup-b.tsx": [
        "class DupB extends HTMLElement {}",
        'customElements.define("x-dup", DupB);',
        "",
      ].join("\n"),
      "apps/web/src/spooky.vue": [
        "<template>",
        "  <div>",
        "    <GhostWidget />",
        "    <x-dup></x-dup>",
        "  </div>",
        "</template>",
        "",
      ].join("\n"),
      "apps/web/scout.config.json": JSON.stringify({
        repoId: "workspace-subscan",
        include: ["src/**/*.{tsx,vue}"],
        exclude: [],
      }),
    });
    out = scan(join(stage, "apps", "web"));
  });

  afterAll(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it("late-bound-render filePath is the occurrence-space path", () => {
    const occ = out.occurrences.find((o) => o.filePath.endsWith("haunted.tsx"));
    expect(occ?.filePath).toBe("apps/web/src/haunted.tsx");
    const slot = out.diagnostics.filter(
      (d) => d.code === "late-bound-render" && d.symbol === "Slot",
    );
    expect(slot).toHaveLength(1);
    expect(slot[0]).toMatchObject({ filePath: occ?.filePath });
  });

  it("reports two registrations of one tag as a conflict, their locators carrying the sub-package prefix once", () => {
    const dup = out.components.find((c) => c.identity.kind === "tag" && c.identity.tagName === "x-dup");
    const target = (file: string, exportName: string) => ({
      kind: "repository",
      repoId: "workspace-subscan",
      filePath: `apps/web/src/${file}`,
      exportName,
    });
    expect(dup?.attribution).toMatchObject({
      status: "conflict",
      strongestClass: "observed",
      candidates: [target("dup-a.tsx", "DupA"), target("dup-b.tsx", "DupB")],
    });
    expect(dup?.attribution?.evidence.map((e) => [e.locator, e.disposition])).toEqual([
      [{ filePath: "apps/web/src/dup-a.tsx", line: 2 }, "candidate"],
      [{ filePath: "apps/web/src/dup-b.tsx", line: 2 }, "candidate"],
    ]);
  });

  it("trace step file paths carry the sub-package prefix once", () => {
    const traced = out.occurrences
      .filter((o) => o.filePath === "apps/web/src/traced.tsx")
      .flatMap((o) =>
        o.trace.flatMap((step) => {
          if (isKind(step, "helper-call")) return [[step.kind, step.calleeFile]];
          if (isKind(step, "dynamic-map")) return [[step.kind, step.mapLoc.file]];
          if (isKind(step, "prop-forward")) return [[step.kind, step.constructionSite.file]];
          return [];
        }),
      )
      .sort();
    expect(traced).toEqual([
      ["dynamic-map", "apps/web/src/traced.tsx"],
      ["helper-call", "apps/web/src/traced.tsx"],
      ["prop-forward", "apps/web/src/traced.tsx"],
    ]);
  });

  it("unresolved occurrence filePaths carry the sub-package prefix once", () => {
    const unresolved = out.occurrences
      .flatMap(({ resolution, filePath }) =>
        resolution.status === "unresolved" ? [["name" in resolution.reason ? resolution.reason.name : undefined, filePath]] : [],
      )
      .sort();
    expect(unresolved).toEqual([
      ["Ghost", "apps/web/src/haunted.tsx"],
      ["GhostWidget", "apps/web/src/spooky.vue"],
    ]);
  });
});
