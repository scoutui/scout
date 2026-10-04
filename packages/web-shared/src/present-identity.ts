import type { Component, EvidenceRecord } from "@scoutui/scan-format";

/** The component fields identity presentation reads; a full `Component` and a stored `ComponentDigest` both satisfy it. */
export type PresentableComponent = Pick<Component, "identity" | "framework" | "attribution" | "owningPackage">;

/** A scan-file identity in the UI's vocabulary. */
export type Presented = {
  /** Local: a repository declaration, or a tag this scan resolves to a repository or that only repository files claim. */
  scope: "local" | "external";
  kind: "react-component" | "vue-component" | "custom-element" | "tag";
  /** The package export's package, a repository declaration's package (its workspace package, or the root package), or the package this scan resolves a tag to. */
  packageName: string | null;
  exportName: string | null;
  tagName: string | null;
  filePath: string | null;
  publicEntry: string | null;
};

/** Evidence sources that define a custom element: a CEM declaration, or a `customElements.define` registration. */
const DEFINES_ELEMENT: ReadonlySet<EvidenceRecord["source"]> = new Set(["cem", "registration"]);

export function presentIdentity(component: PresentableComponent): Presented {
  const { identity } = component;
  const frameworkKind = component.framework === "vue" ? "vue-component" : "react-component";
  switch (identity.kind) {
    case "package-export":
      return {
        scope: "external", kind: frameworkKind, packageName: identity.packageName,
        exportName: identity.exportName, tagName: null, filePath: null, publicEntry: identity.publicEntry,
      };
    case "repository-declaration":
      return {
        scope: "local", kind: frameworkKind, packageName: component.owningPackage ?? null,
        exportName: identity.exportName, tagName: null, filePath: identity.filePath, publicEntry: null,
      };
    case "tag": {
      const attribution = component.attribution;
      const target = attribution?.status === "resolved" ? attribution.target : undefined;
      const inRepo = target ? target.kind === "repository" : attribution?.status === "conflict" && attribution.candidates.every(candidate => candidate.kind === "repository");
      return {
        scope: inRepo ? "local" : "external",
        kind: attribution?.evidence.some(record => DEFINES_ELEMENT.has(record.source)) ? "custom-element" : "tag",
        packageName: target?.kind === "package" ? target.packageName : null,
        exportName: null,
        tagName: identity.tagName,
        filePath: target?.kind === "repository" ? target.filePath : null,
        publicEntry: null,
      };
    }
  }
}

/** Each package or repository file that claims a tag the scan found more than one definition for; empty otherwise. */
export function tagClaimants(component: Pick<Component, "attribution">): string[] {
  const { attribution } = component;
  if (attribution?.status !== "conflict") return [];
  return attribution.candidates.map(target => (target.kind === "package" ? target.packageName : target.filePath));
}

/** What tells a component apart from another with the same package and name: an external one's entry point, a local one's file. */
export function disambiguatorOf(presented: Presented): string | null {
  return presented.scope === "external" ? presented.publicEntry : presented.filePath;
}

/**
 * The governance key: the presented package and name (export or tag) of a component, so a
 * repository declaration counts under its package. Null when ungovernable: a component
 * with no package (a repository declaration with no `owningPackage`, a tag resolved to a
 * repository, an unknown or conflicting tag).
 */
export function governanceKey(component: PresentableComponent): { packageName: string; name: string } | null {
  const { packageName, exportName, tagName } = presentIdentity(component);
  const name = exportName ?? tagName;
  return packageName !== null && name !== null ? { packageName, name } : null;
}

/** `governanceKey` as read-model rows store it: both fields null when the component is ungovernable. */
export type GovernanceIdentity = { packageName: string | null; exportName: string | null };

export function governanceIdentity(component: PresentableComponent): GovernanceIdentity {
  const key = governanceKey(component);
  return { packageName: key?.packageName ?? null, exportName: key?.name ?? null };
}
