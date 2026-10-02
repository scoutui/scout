import type { Component, Occurrence, ScanArtifact, TagAttribution } from "@scoutui/scan-format";
import type { GovernanceRecord, Tag } from "../../src/dto.js";
import { artifact, component, packageExport, repoDeclaration, resolvedAt, tag, unresolvedAt } from "./builders.ts";

export const tags: Tag[] = [{ id: "core", value: "core", category: "library", color: "#123456", rule: { glob: ["@sample/*"], exact: [] } }];
export const governance: GovernanceRecord[] = [
  { id: "package", grain: "package", targetPackage: "@sample/core", targetExport: null, disposition: { kind: "retired", reason: "Package retired" }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "exact", grain: "component", targetPackage: "@sample/core", targetExport: "Button", disposition: { kind: "superseded", by: { packageName: "@sample/new", exportName: "Button" } }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];
export const overlays = [
  { name: "initial", tags, governance },
  { name: "changed", tags: [{ ...tags[0], id: "reassigned", value: "reassigned", category: "library", color: "#654321", rule: { glob: [], exact: ["@sample/mixed"] } }] as Tag[], governance: governance.slice(0, 1) },
  { name: "cleared", tags: [], governance: [] },
];

function attributedTag(tagName: string, attribution: TagAttribution): Component {
  return component(tag(tagName), {
    attribution,
    stats: { occurrenceCount: 1, fileCount: 1 },
    usage: "direct",
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 1, isLeafCount: 1 },
  });
}

function scan(repoId: string, scanId: string, scannedAt: string, exportName = "Button", includeMixed = true, commit = "abc"): ScanArtifact {
  const button = component(packageExport("@sample/core", exportName), {
    stats: { occurrenceCount: 1, fileCount: 1 }, usage: "direct", version: repoId === "repo-b" ? "2.0.0" : "1.0.0",
    props: { size: { values: [{ provenance: "written", value: "small", count: 1 }], dynamic: 0, omitted: 0 } },
    events: { click: { boundCount: 1 } },
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 0, isLeafCount: 1 },
  });
  const element = attributedTag("sample-button", { status: "resolved", target: { kind: "package", packageName: "@sample/core" }, confidence: "observed", evidence: [] });
  const unknown = attributedTag("sample-unknown", { status: "unknown", reason: "absent", evidence: [] });
  const conflict = attributedTag("sample-conflict", {
    status: "conflict", strongestClass: "observed",
    candidates: [{ kind: "package", packageName: "@sample/core" }, { kind: "package", packageName: "@sample/mixed" }], evidence: [],
  });
  const alternate = component(packageExport("@sample/core", "Button", "./alternate"), { version: "1.0.0" });
  const local = component(repoDeclaration(repoId, "src/panel.tsx", "Panel"), {
    ...(repoId === "repo-b" ? { owningPackage: "@example/app-kit" } : {}),
    stats: { occurrenceCount: 1, fileCount: 1 }, usage: "direct", writtenNames: ["SettingsPanel"],
    composition: { rendersByCount: { [button.id]: 1 }, renderedByCount: {}, isRootCount: 1, isLeafCount: 0 },
    declared: { props: { label: { type: "string", required: true } }, hasRest: true },
  });
  button.composition.renderedByCount[local.id] = 1;
  const localAlternate = component(repoDeclaration(repoId, "src/other/panel.tsx", "Panel"));
  const mixed = component(packageExport("@sample/mixed", "Field"), {
    framework: "vue", stats: { occurrenceCount: 1, fileCount: 1 }, usage: "direct",
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 1, isLeafCount: 1 },
  });
  const member = component(packageExport("@sample/core", "Button.Icon"), {
    stats: { occurrenceCount: 1, fileCount: 1 }, usage: "direct",
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 1, isLeafCount: 1 },
  });
  const components = [button, element, unknown, conflict, alternate, local, localAlternate, member, ...(includeMixed ? [mixed] : [])];
  const occurrences: Occurrence[] = [
    resolvedAt(local, "src/z.tsx", 2, { occurrenceId: "parent", writtenName: "SettingsPanel", trace: [{ kind: "import", specifier: "./panel", name: "Panel" }] }),
    resolvedAt(button, "src/z.tsx", 3, { occurrenceId: "child", column: 2, ownerComponentId: local.id, props: { size: { tier: "written", value: "small" } }, events: ["click"], trace: [{ kind: "import", specifier: "@sample/core", name: exportName }] }),
    resolvedAt(member, "src/z.tsx", 4, { occurrenceId: "member", trace: [{ kind: "import", specifier: "@sample/core", name: "Button.Icon" }] }),
    resolvedAt(element, "src/z.tsx", 5, { occurrenceId: "element", trace: [{ kind: "tag", written: "sample-button" }] }),
    resolvedAt(unknown, "src/z.tsx", 6, { occurrenceId: "unknown-tag", trace: [{ kind: "tag", written: "sample-unknown" }] }),
    resolvedAt(conflict, "src/z.tsx", 7, { occurrenceId: "conflict-tag", trace: [{ kind: "tag", written: "sample-conflict" }] }),
    unresolvedAt({ kind: "unbound-name", name: "Missing" }, "src/z.tsx", 8),
  ];
  if (includeMixed) occurrences.push(resolvedAt(mixed, "src/a.vue", 1, { occurrenceId: "field", trace: [{ kind: "import", specifier: "@sample/mixed", name: "Field" }] }));
  const result = artifact({ repoId, scanId, scannedAt, components, occurrences });
  result.meta.repo.commit = commit;
  result.meta.repo.branch = "main";
  return result;
}

export function genericArtifacts(): ScanArtifact[] {
  return [
    scan("repo-a", "scan-current", "2026-06-02T00:00:00Z"),
    artifact({ repoId: "repo-empty", scanId: "scan-empty", scannedAt: "2026-06-02T00:00:00Z", components: [], occurrences: [] }),
    scan("repo-a", "scan-previous", "2026-06-01T00:00:00Z", "Button", false, "def"),
    scan("repo-b", "scan-other", "2026-06-02T00:00:00Z", "ActionButton"),
  ];
}
