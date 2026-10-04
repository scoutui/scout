import { describe, expect, it } from "vitest";
import type { ScanArtifact, TagAttribution } from "@scoutui/scan-format";
import { createProjectionContext, deriveReadModelRows } from "../src/index.js";
import { artifact, component, packageExport, resolvedAt, tag, unresolvedAt } from "./helpers/builders.js";

function findingsOf(scan: ScanArtifact) {
  return [...deriveReadModelRows(scan, createProjectionContext(scan))].flatMap(row => row.kind === "repo" ? row.findings : []);
}

const withDiagnostics = (diagnostics: ScanArtifact["diagnostics"]) => ({ ...artifact({ components: [], occurrences: [] }), diagnostics });

function element(tagName: string, attribution: TagAttribution, uses: number) {
  const c = component(tag(tagName), { attribution });
  return { component: c, occurrences: Array.from({ length: uses }, (_, i) => resolvedAt(c, "src/App.vue", i + 1)) };
}

describe("what a scan couldn't see", () => {
  it("reports nothing when every use was matched", () => {
    const button = component(packageExport("@example/ui", "Button"));
    const matched = [resolvedAt(button, "src/App.tsx")];
    expect(findingsOf(artifact({ components: [button], occurrences: matched }))).toEqual([]);
    const unmatched = unresolvedAt({ kind: "unbound-name", name: "Card" }, "src/App.tsx", 2);
    expect(findingsOf(artifact({ components: [button], occurrences: [...matched, unmatched] })).map(f => f.kind)).toEqual(["not-imported"]);
  });

  it("counts each web component no package or code defines, with its uses, and leaves out the ones a package or file defines or two packages claim", () => {
    const unknown = element("x-tooltip", { status: "unknown", reason: "absent", evidence: [] }, 2);
    const resolved = element("x-button", { status: "resolved", target: { kind: "package", packageName: "@example/elements" }, confidence: "declared", evidence: [] }, 1);
    const conflict = element("x-card", { status: "conflict", strongestClass: "declared", candidates: [], evidence: [] }, 1);
    const scan = artifact({
      components: [unknown.component, resolved.component, conflict.component],
      occurrences: [...unknown.occurrences, ...resolved.occurrences, ...conflict.occurrences],
    });
    expect(findingsOf(scan)).toEqual([{ kind: "undefined-element", count: 1, examples: [{ text: "<x-tooltip>", count: 2 }], more: 0 }]);
  });

  it.each([
    ["lazy-import-unsupported", { filePath: "src/Routes.tsx", line: 4, column: 7, specifier: "./Panel", detail: "" }, "lazy-import", "src/Routes.tsx"],
    ["auto-import-stale-entry", { filePath: ".nuxt/components.d.ts", componentName: "PromoBanner", target: "components/PromoBanner.vue" }, "auto-import-missing", "PromoBanner"],
  ])("reports %s as %s", (code, fields, kind, text) => {
    expect(findingsOf(withDiagnostics([{ code, severity: "warning", ...fields }]))).toEqual([{ kind, count: 1, examples: [{ text, count: 1 }], more: 0 }]);
  });

  it("leaves out diagnostic codes it doesn't know", () => {
    const lazy = { code: "lazy-import-unsupported", severity: "warning" as const, filePath: "src/Routes.tsx" };
    expect(findingsOf(withDiagnostics([{ code: "something-new", severity: "warning", filePath: "src/App.tsx" }, lazy])))
      .toEqual([{ kind: "lazy-import", count: 1, examples: [{ text: "src/Routes.tsx", count: 1 }], more: 0 }]);
  });

  it("shows the three most used examples, alphabetically on a tie, and counts the rest", () => {
    const names = ["Menu", "Tooltip", "Menu", "Dropdown", "Tooltip", "Menu", "Avatar", "Badge"];
    const scan = artifact({ components: [], occurrences: names.map((name, i) => unresolvedAt({ kind: "unbound-name", name }, "src/App.vue", i + 1)) });
    expect(findingsOf(scan)).toEqual([{
      kind: "not-imported", count: 8,
      examples: [{ text: "Menu", count: 3 }, { text: "Tooltip", count: 2 }, { text: "Avatar", count: 1 }],
      more: 2,
    }]);
  });
});
