import type { ScanArtifact } from "@scoutui/scan-format";
import { artifact, component, packageExport, repoDeclaration, resolvedAt, tag } from "./builders.js";

type CompSpec = {
  scope: "external" | "local";
  packageName?: string;
  occ: number;
  kind?: "custom-element" | "react-component" | "vue-component";
};

export function mkArtifact(opts: {
  repoId: string;
  scanId: string;
  scannedAt: string;
  components: CompSpec[];
}): ScanArtifact {
  const components = opts.components.map((spec, index) => {
    const identity = spec.scope === "local"
      ? repoDeclaration(opts.repoId, `src/L${index + 1}.tsx`, `L${index + 1}`)
      : spec.kind === "custom-element" || !spec.packageName
        ? tag(`test-element-${index + 1}`)
        : packageExport(spec.packageName, `E${index + 1}`);
    return component(identity, {
      ...(spec.kind === "vue-component" ? { framework: "vue" } : {}),
      stats: { occurrenceCount: spec.occ, fileCount: spec.occ > 0 ? 1 : 0 },
      usage: spec.occ > 0 ? "direct" : "none",
      composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: spec.occ, isLeafCount: spec.occ },
    });
  });
  const occurrences = components.flatMap((item, index) =>
    Array.from({ length: opts.components[index]?.occ ?? 0 }, (_, offset) => resolvedAt(item, `src/usage-${index + 1}.tsx`, offset + 1)));
  return artifact({ repoId: opts.repoId, scanId: opts.scanId, scannedAt: opts.scannedAt, components, occurrences });
}
