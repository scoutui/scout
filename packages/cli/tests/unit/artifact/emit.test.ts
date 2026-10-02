import { describe, expect, it } from "vitest";
import { computeOccurrenceId } from "../../../src/artifact/occurrence-id.js";
import type { ComponentId, EngineOccurrence, OccurrenceVia } from "@scoutui/reference-graph";
import { componentKey } from "@scoutui/scan-format";
import type { StampedMeta } from "../../../src/scan/meta.js";
import { seedFor, type ComponentSeed } from "../../../src/seeds.js";
import { emitArtifact, type EmitInput } from "../../../src/artifact/emit.js";
import type { CemClaim } from "../../../src/artifact/tag-evidence.js";
import { assertValidArtifact } from "../../helpers/artifact.js";

const meta: StampedMeta = {
  scannerVersion: "0.0.0-test",
  scanId: "01TEST000000000000000000000",
  scannedAt: "2026-01-01T00:00:00.000Z",
  repo: { id: "r", gitRemote: null, commit: "abc123", committedAt: "2025-12-31T12:00:00.000Z", initialCommit: "abc123", branch: null },
};

const local = (exportName: string): ComponentId => ({
  kind: "react-component",
  export: exportName,
  source: { type: "local", filePath: `src/${exportName}.tsx` },
});

const seedOf = (componentId: ComponentId): ComponentSeed => seedFor(componentId, { repoId: "r" });

const localSeed = (exportName: string): ComponentSeed => seedOf(local(exportName));

/** A tag reads an `html-tag` via; a component, a same-file `local-component` render. */
const occurrence = (rawComponentId: ComponentId, line: number, rawOwnerComponentId?: ComponentId): EngineOccurrence => {
  const via: OccurrenceVia = rawComponentId.kind === "custom-element" ? { kind: "html-tag" } : { kind: "local-component" };
  return {
    rawComponentId,
    filePath: "src/App.tsx",
    line,
    column: 1,
    via,
    viaChain: [via],
    props: {},
    events: [],
    occurrenceKey: `provisional-${line}`,
    ...(rawOwnerComponentId !== undefined ? { rawOwnerComponentId } : {}),
  };
};

const unresolvedOccurrence = (line: number, rawOwnerComponentId: ComponentId): EngineOccurrence => ({
  unresolved: { kind: "package-not-installed", packageName: "@example/ui" },
  writtenRef: "@example/ui#Button",
  filePath: "src/App.tsx",
  line,
  column: 1,
  via: { kind: "direct-import", specifier: "@example/ui", import: "Button" },
  viaChain: [{ kind: "direct-import", specifier: "@example/ui", import: "Button" }],
  props: { kind: { tier: "written", value: "a" } },
  events: [],
  occurrenceKey: `provisional-${line}`,
  rawOwnerComponentId,
});

const emit = (seeds: ComponentSeed[], occurrences: EngineOccurrence[], cem: [string, CemClaim[]][] = []) =>
  emitArtifact({
    meta,
    repoId: "r",
    seeds,
    occurrences,
    diagnostics: [],
    tagEvidence: { registrations: new Map(), cem: new Map(cem), globalDeclarations: new Map() },
    declaredIn: new Map(),
    readVersion: async () => null,
  } satisfies EmitInput);

describe("emitArtifact", () => {
  it("writes the scan file's meta and no summary counts", async () => {
    const out = await emit([localSeed("Card")], [occurrence(local("Card"), 1)]);
    assertValidArtifact(out);
    expect(out.meta).toEqual({
      schemaVersion: 2,
      scannerVersion: "0.0.0-test",
      scanId: meta.scanId,
      scannedAt: meta.scannedAt,
      repo: meta.repo,
    });
    expect(out).not.toHaveProperty("stats");
  });

  it("credits tags that differ only in case to one component", async () => {
    const lower: ComponentId = { kind: "custom-element", tagName: "x-card", source: { type: "unknown" } };
    const upper: ComponentId = { kind: "custom-element", tagName: "X-Card", source: { type: "unknown" } };
    const out = await emit(
      [seedOf(lower)],
      [occurrence(lower, 1), occurrence(upper, 2)],
      [["x-card", [{ packageName: "@example/cards", version: "1.0.0" }]]],
    );
    assertValidArtifact(out);
    const id = componentKey({ kind: "tag", tagName: "x-card" });
    expect(out.components.map((c) => c.id)).toEqual([id]);
    expect(out.components[0]?.stats.occurrenceCount).toBe(2);
    expect(out.components[0]?.attribution).toMatchObject({ status: "resolved", target: { kind: "package", packageName: "@example/cards" } });
    expect(out.occurrences.map((o) => o.resolution)).toEqual([
      { status: "resolved", componentId: id },
      { status: "resolved", componentId: id },
    ]);
    expect(out.occurrences[1]?.trace).toEqual([{ kind: "tag", written: "X-Card" }]);
  });

  it("lowercases a tag's ASCII letters only, so tags differing in a non-ASCII letter's case stay apart", async () => {
    const upper: ComponentId = { kind: "custom-element", tagName: "my-Élan", source: { type: "unknown" } };
    const lower: ComponentId = { kind: "custom-element", tagName: "my-élan", source: { type: "unknown" } };
    const out = await emit(
      [seedOf(upper), seedOf(lower)],
      [occurrence(upper, 1), occurrence(lower, 2)],
    );
    assertValidArtifact(out);
    expect(out.components.map((c) => c.identity)).toEqual([
      { kind: "tag", tagName: "my-Élan" },
      { kind: "tag", tagName: "my-élan" },
    ]);
  });

  it("re-keys owners, so composition links scan-file ids", async () => {
    const out = await emit([localSeed("Page"), localSeed("Button")], [occurrence(local("Button"), 1, local("Page"))]);
    assertValidArtifact(out);
    const page = out.components.find((c) => c.identity.kind === "repository-declaration" && c.identity.exportName === "Page");
    const button = out.components.find((c) => c.identity.kind === "repository-declaration" && c.identity.exportName === "Button");
    expect(page?.composition.rendersByCount).toEqual({ [button?.id ?? ""]: 1 });
    expect(out.occurrences[0]?.ownerComponentId).toBe(page?.id);
  });

  it("emits an unresolved occurrence keyed on its written reference, keeps its re-keyed owner, and creates no component", async () => {
    const out = await emit([localSeed("Page")], [unresolvedOccurrence(4, local("Page"))]);
    assertValidArtifact(out);
    const page = out.components.find((c) => c.identity.kind === "repository-declaration" && c.identity.exportName === "Page");
    expect(out.components.map((c) => c.id)).toEqual([page?.id]);
    expect(out.occurrences).toEqual([
      {
        occurrenceId: computeOccurrenceId("unresolved:@example/ui#Button", "src/App.tsx", 4, 1, page?.id),
        resolution: { status: "unresolved", reason: { kind: "package-not-installed", packageName: "@example/ui" } },
        filePath: "src/App.tsx",
        line: 4,
        column: 1,
        credit: { kind: "render" },
        trace: [{ kind: "import", specifier: "@example/ui", name: "Button" }],
        props: { kind: { tier: "written", value: "a" } },
        ownerComponentId: page?.id,
      },
    ]);
  });

  it("adds one dependency-not-installed diagnostic per declared package that isn't installed, after the scanner's", async () => {
    const cycle = { code: "cycle-detected", severity: "warning", filePath: "src/a.ts", exportName: "A" } as const;
    const out = await emitArtifact({
      meta,
      repoId: "r",
      seeds: [localSeed("Page")],
      occurrences: [unresolvedOccurrence(4, local("Page")), unresolvedOccurrence(5, local("Page"))],
      diagnostics: [cycle],
      tagEvidence: { registrations: new Map(), cem: new Map(), globalDeclarations: new Map() },
      declaredIn: new Map([["@example/ui", "apps/web/package.json"]]),
      readVersion: async () => null,
    });
    assertValidArtifact(out);
    expect(out.diagnostics).toEqual([
      cycle,
      {
        code: "dependency-not-installed",
        severity: "warning",
        packageName: "@example/ui",
        occurrenceCount: 2,
        declaredIn: "apps/web/package.json",
      },
    ]);
  });

  it("drops a local component that is neither rendered nor renders anything", async () => {
    const out = await emit([localSeed("Orphan"), localSeed("Used")], [occurrence(local("Used"), 1)]);
    expect(out.components.map((c) => c.identity.kind === "repository-declaration" && c.identity.exportName)).toEqual(["Used"]);
  });
});
