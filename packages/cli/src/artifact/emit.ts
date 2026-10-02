import { computeOccurrenceId } from "./occurrence-id.js";
import type { ComponentId, EngineOccurrence } from "@scoutui/reference-graph";
import type { Diagnostic } from "../diagnostic.js";
import {
  parseCompoundExport,
  resolvedOccurrences,
  sameComponentName,
  SCHEMA_VERSION,
  type Component,
  type Identity,
  type Occurrence,
  type Resolution,
  type ScanArtifact,
} from "@scoutui/scan-format";
import { resolveTagAttribution } from "./tag-attribution.js";
import { applyCompositionRollup } from "../composition-rollup.js";
import { rollupOccurrencesToComponents, type ComponentRow } from "../rollup.js";
import type { StampedMeta } from "../scan/meta.js";
import type { ComponentSeed } from "../seeds.js";
import { scanIdOf, toIdentity } from "./identity.js";
import { collectTagEvidence, type TagEvidenceSources } from "./tag-evidence.js";
import { toCreditAndTrace } from "./trace.js";
import { packagesNotInstalled } from "./not-installed.js";
import { type PackageVersionReader, withInstalledVersions } from "../scan/stamp-version.js";

export type EmitInput = {
  meta: StampedMeta;
  repoId: string;
  /** Every observed component: parser, roster and engine seeds, one per scan-file id (`seedFor`). */
  seeds: ComponentSeed[];
  /** Engine occurrences with output-space file paths and component ids. */
  occurrences: EngineOccurrence[];
  diagnostics: Diagnostic[];
  /** This scan's evidence for attributing each tag. */
  tagEvidence: TagEvidenceSources;
  /** The repository-relative package.json that declares each package the engine found declared. */
  declaredIn: ReadonlyMap<string, string>;
  /** Reads a package's installed version (`installedVersionReader`). */
  readVersion: PackageVersionReader;
};

/**
 * Builds the scan file. Occurrence and owner ids are the scan-file ids of the
 * engine's components (`scanIdOf`). An unresolved engine occurrence becomes an unresolved
 * occurrence, its id keyed on `unresolved:` + its written reference. Each
 * component carries its package's installed version, and each declared
 * package that isn't installed adds a `dependency-not-installed` diagnostic
 * after the engine's.
 */
export async function emitArtifact(input: EmitInput): Promise<ScanArtifact<Diagnostic>> {
  const { meta, repoId } = input;

  const rows = input.seeds.map((seed) => toRow(seed, input.tagEvidence));
  const idOf = (raw: ComponentId): string => scanIdOf(raw, repoId);

  const occurrences: Occurrence[] = input.occurrences.map((eo) => {
    const { resolution, idKey } = resolutionOf(eo, idOf);
    const ownerComponentId = eo.rawOwnerComponentId !== undefined ? idOf(eo.rawOwnerComponentId) : undefined;
    const authoredTag = eo.rawComponentId?.kind === "custom-element" ? eo.rawComponentId.tagName : undefined;
    const { credit, trace } = toCreditAndTrace(eo.viaChain, authoredTag);
    const writtenName =
      eo.rawComponentId !== undefined ? recordedWrittenName(eo.writtenName, toIdentity(eo.rawComponentId, repoId)) : undefined;
    return {
      occurrenceId: computeOccurrenceId(idKey, eo.filePath, eo.line, eo.column, ownerComponentId),
      resolution,
      filePath: eo.filePath,
      line: eo.line,
      column: eo.column,
      credit,
      trace,
      ...(writtenName !== undefined ? { writtenName } : {}),
      props: eo.props,
      ...(eo.events.length > 0 ? { events: eo.events } : {}),
      ...(ownerComponentId !== undefined ? { ownerComponentId } : {}),
    };
  });

  const resolved = resolvedOccurrences(occurrences);
  const components = await withInstalledVersions(
    dropUnreachableLocalComponents(applyCompositionRollup(rollupOccurrencesToComponents(resolved, rows), resolved), occurrences),
    occurrences,
    input.readVersion,
  );
  const notInstalled = [...packagesNotInstalled(occurrences)].map(
    ([packageName, occurrenceCount]): Diagnostic => ({
      code: "dependency-not-installed",
      severity: "warning",
      packageName,
      occurrenceCount,
      declaredIn: input.declaredIn.get(packageName) ?? "",
    }),
  );

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      ...(meta.scannerName !== undefined ? { scannerName: meta.scannerName } : {}),
      scannerVersion: meta.scannerVersion,
      scanId: meta.scanId,
      scannedAt: meta.scannedAt,
      repo: meta.repo,
    },
    components,
    occurrences,
    diagnostics: [...input.diagnostics, ...notInstalled],
  };
}

/**
 * An engine occurrence's resolution, and the key its occurrence id hashes:
 * the component id, or `unresolved:` + its written reference.
 */
function resolutionOf(
  eo: EngineOccurrence,
  idOf: (raw: ComponentId) => string,
): { resolution: Resolution; idKey: string } {
  if (eo.rawComponentId === undefined) {
    return { resolution: { status: "unresolved", reason: eo.unresolved }, idKey: `unresolved:${eo.writtenRef}` };
  }
  const componentId = idOf(eo.rawComponentId);
  return { resolution: { status: "resolved", componentId }, idKey: componentId };
}

/**
 * The written name a resolved occurrence records: the name it renders its component through, unless that is the
 * component's declared name (`sameComponentName`). A package's default export declares no name, so it always records.
 */
function recordedWrittenName(written: string | undefined, identity: Identity): string | undefined {
  if (written === undefined) return undefined;
  const declared =
    identity.kind === "tag"
      ? identity.tagName
      : identity.kind === "package-export" && parseCompoundExport(identity.exportName).root === "default"
        ? undefined
        : identity.exportName;
  return declared !== undefined && sameComponentName(written, declared) ? undefined : written;
}

/**
 * One component's row from its seed. A tag's attribution comes from this scan's evidence
 * for its name, and it carries nothing else.
 */
function toRow(seed: ComponentSeed, tagEvidence: TagEvidenceSources): ComponentRow {
  const { id, identity } = seed;
  if (identity.kind !== "tag") return seed;
  const { tagName } = identity;
  const evidence = collectTagEvidence({
    registrations: tagEvidence.registrations.get(tagName) ?? [],
    cem: tagEvidence.cem.get(tagName) ?? [],
    globalDeclarations: tagEvidence.globalDeclarations.get(tagName) ?? [],
  });
  return { id, identity, attribution: resolveTagAttribution(evidence) };
}

/**
 * Drops local components that contribute nothing to the artifact: no
 * occurrences, in no composition edge, and owning no occurrence, resolved or
 * not. A workspace scan finds thousands of these, one for each local component
 * the include glob walks past. Such a component is unreachable in the
 * dependency graph, so dropping it loses nothing.
 *
 * A component is local when it is a repository declaration or a tag this
 * repository registers. Others are kept unconditionally.
 */
function dropUnreachableLocalComponents(components: Component[], occurrences: readonly Occurrence[]): Component[] {
  const owners = new Set(occurrences.flatMap((o) => (o.ownerComponentId !== undefined ? [o.ownerComponentId] : [])));
  return components.filter((c) => {
    const local =
      c.identity.kind === "repository-declaration" ||
      (c.attribution?.evidence.some((e) => e.source === "registration") ?? false);
    if (!local) return true;
    if (c.stats.occurrenceCount > 0 || owners.has(c.id)) return true;
    const rendersN = Object.keys(c.composition.rendersByCount).length;
    const renderedByN = Object.keys(c.composition.renderedByCount).length;
    return rendersN > 0 || renderedByN > 0;
  });
}
