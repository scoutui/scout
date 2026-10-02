import { relative } from "node:path";
import { posixPath } from "@scoutui/reference-graph";
import type { LocalDefinitionIndex } from "../local-index/types.js";
import type { AttributionTarget, KnownEvidenceRecord } from "@scoutui/scan-format";
import { registeredClassName } from "../local-index/detect-wc.js";
import type { CemIndex } from "../scan/cem-index.js";
import type { GlobalComponentsRegistry } from "../scan/global-components.js";

/** A first-party `customElements.define` / `@customElement` registration, with the target its constructor resolves to. */
export type Registration = { filePath: string; line: number; target: AttributionTarget | null };
/** An installed package whose `package.json#customElements` CEM declares the tag. */
export type CemClaim = { packageName: string; version: string | null };
/** A `GlobalComponents` member keyed by the tag, with the target its import resolves to. */
export type GlobalDeclaration = { target: AttributionTarget | null; filePath: string; line: number };

/** This scan's evidence inputs, each keyed by canonical tag name. All paths are repository-relative. */
export type TagEvidenceSources = {
  registrations: ReadonlyMap<string, readonly Registration[]>;
  cem: ReadonlyMap<string, readonly CemClaim[]>;
  globalDeclarations: ReadonlyMap<string, readonly GlobalDeclaration[]>;
};

/**
 * What the scanner's shared declaration answer names, as an attribution
 * target: a registration's constructor (`className` in the registering file,
 * output-space path), or a `GlobalComponents` member's import. Null when it
 * names neither a package export nor a repository declaration.
 */
export type TargetResolver = {
  registration(filePath: string, className: string): AttributionTarget | null;
  globalDeclaration(declarationPath: string, specifier: string, imported: string): AttributionTarget | null;
};

/**
 * Every evidence record for one tag, not yet weighed: a registration is
 * `observed`; a CEM claim and a global declaration are `declared`. A record
 * without a target is `unresolved`; every other record is a `candidate` until
 * `resolveTagAttribution` weighs the records and assigns its final
 * disposition.
 */
export function collectTagEvidence(inputs: {
  registrations: readonly Registration[];
  cem: readonly CemClaim[];
  globalDeclarations: readonly GlobalDeclaration[];
}): KnownEvidenceRecord[] {
  const record = (
    source: KnownEvidenceRecord["source"],
    strength: KnownEvidenceRecord["strength"],
    locator: KnownEvidenceRecord["locator"],
    target: AttributionTarget | null,
  ): KnownEvidenceRecord =>
    target === null
      ? { source, strength, locator, disposition: "unresolved" }
      : { source, strength, locator, target, disposition: "candidate" };

  return [
    ...inputs.registrations.map(({ filePath, line, target }) =>
      record("registration", "observed", { filePath, line }, target),
    ),
    ...inputs.cem.map(({ packageName, version }) =>
      record("cem", "declared", { packageName, version }, { kind: "package", packageName }),
    ),
    ...inputs.globalDeclarations.map(({ target, filePath, line }) =>
      record("global-declaration", "declared", { filePath, line }, target),
    ),
  ];
}

/**
 * Gathers this scan's tag evidence: first-party registrations from the local
 * index, CEM claims from the CEM index, and `GlobalComponents` members keyed
 * by a valid custom element name. Registration constructors and member
 * imports are resolved through `resolveTarget`; a registration that names no
 * class, and a member whose in-repo file is missing, get no target.
 */
export function tagEvidenceSources(input: {
  localIndex: LocalDefinitionIndex;
  cemIndex: CemIndex;
  globalComponents: GlobalComponentsRegistry | null;
  resolveTarget: TargetResolver;
  outputRoot: string;
}): TagEvidenceSources {
  const { resolveTarget } = input;

  const registrations = new Map<string, Registration[]>();
  for (const [tagName, defs] of input.localIndex.byTag) {
    const found: Registration[] = [];
    for (const def of defs) {
      // detect-wc records every registration's position.
      if (def.componentId.source.type !== "local" || def.loc === undefined) continue;
      const { filePath } = def.componentId.source;
      const className = registeredClassName(def);
      const target = className === null ? null : resolveTarget.registration(filePath, className);
      found.push({ filePath, line: def.loc.line, target });
    }
    registrations.set(tagName, found);
  }

  const cem = new Map<string, CemClaim[]>();
  for (const [tagName, claims] of input.cemIndex.byTag) {
    cem.set(
      tagName,
      claims.map(({ packageName, version }) => ({ packageName, version })),
    );
  }

  const globalDeclarations = new Map<string, GlobalDeclaration[]>();
  const registry = input.globalComponents;
  if (registry !== null) {
    const filePath = posixPath(relative(input.outputRoot, registry.declarationPath));
    for (const d of registry.tagDeclarations) {
      const target =
        d.specifier === null ? null : resolveTarget.globalDeclaration(registry.declarationPath, d.specifier, d.imported);
      const found = globalDeclarations.get(d.tagName) ?? [];
      found.push({ target, filePath, line: d.line });
      globalDeclarations.set(d.tagName, found);
    }
  }

  return { registrations, cem, globalDeclarations };
}
