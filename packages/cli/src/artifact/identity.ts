import { canonicalTagName, type ComponentId, type ComponentKind } from "@scoutui/reference-graph";
import { componentKey, type Framework, type Identity } from "@scoutui/scan-format";

/**
 * Names an engine component as the scan file's identity union: a custom element of any
 * source becomes a `tag` (`canonicalTagName`), a local component a
 * `repository-declaration` in `repoId`, and a package's component a `package-export`.
 */
export function toIdentity(componentId: ComponentId, repoId: string): Identity {
  if (componentId.kind === "custom-element") return { kind: "tag", tagName: canonicalTagName(componentId.tagName) };
  const { source } = componentId;
  if (source.type === "local") {
    return { kind: "repository-declaration", repoId, filePath: source.filePath, exportName: componentId.export };
  }
  return {
    kind: "package-export",
    packageName: source.package,
    publicEntry: source.publicEntry ?? "",
    exportName: componentId.export,
  };
}

/** An engine component's scan-file id: the `componentKey` of its `toIdentity`. */
export function scanIdOf(componentId: ComponentId, repoId: string): string {
  return componentKey(toIdentity(componentId, repoId));
}

/** The framework a component is written for; tags carry none. */
export function frameworkOf(kind: ComponentKind): Framework | undefined {
  if (kind === "react-component") return "react";
  if (kind === "vue-component") return "vue";
  return undefined;
}
