import { describe, it, expect, vi } from "vitest";
import { printSummary } from "../../../src/reporter/stdout.js";
import { createColor } from "../../../src/util/color.js";
import type { Component, ScanArtifact } from "@scoutui/scan-format";
import type { ScanStats } from "../../../src/artifact/scan-stats.js";

const baseMeta: ScanArtifact["meta"] = {
  schemaVersion: 2,
  scannerVersion: "0.0.0-test",
  scanId: "01TEST000000000000000000000",
  scannedAt: "2026-05-07T00:00:00.000Z",
  repo: {
    id: "r",
    gitRemote: null,
    commit: "abc123",
    committedAt: "2026-05-06T12:00:00.000Z",
    initialCommit: null,
    branch: null,
  },
};

const component = (id: string, identity: Component["identity"], occurrenceCount: number): Component => ({
  id,
  identity,
  ...(identity.kind === "tag" ? {} : { framework: "react" as const }),
  stats: { occurrenceCount, fileCount: 1 },
  usage: "direct",
  props: {},
  composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 0, isLeafCount: 0 },
  version: null,
});

const packageExport = (packageName: string, exportName: string, publicEntry = "") =>
  ({ kind: "package-export", packageName, publicEntry, exportName }) as const;
const declaredIn = (filePath: string, exportName: string) =>
  ({ kind: "repository-declaration", repoId: "r", filePath, exportName }) as const;

function capture(components: Component[], stats: ScanStats): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
    chunks.push(s);
    return true;
  }) as typeof process.stdout.write);
  printSummary({ meta: baseMeta, components, occurrences: [], diagnostics: [] }, stats, createColor({ isTTY: false, env: {} }));
  spy.mockRestore();
  return chunks.join("");
}

describe("printSummary", () => {
  it("counts the components and matched occurrences, says how many it couldn't match, and lists the five most used with where each comes from", () => {
    const printed = capture(
      [
        component("a", packageExport("@acme/ui", "Button"), 3),
        component("b", declaredIn("src/components/ProductCard.tsx", "ProductCard"), 2),
        component("c", declaredIn("src/Checkout.tsx", "Checkout"), 1),
        component("d", packageExport("@acme/ui-legacy", "LegacyButton"), 2),
        component("e", packageExport("@acme/ui", "Card"), 2),
        component("f", declaredIn("src/components/Header.tsx", "Header"), 2),
      ],
      { filesScanned: 3, scanDurationMs: 100, componentCount: 6, occurrenceCount: 13, resolvedOccurrenceCount: 12 },
    );
    expect(printed).toBe(
      [
        "Scanned 3 files in 0.1s: 6 components, 12 occurrences.",
        "Scout couldn't match 1 more occurrence to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences",
        "",
        "Most used:",
        "  Button        @acme/ui                        3",
        "  ProductCard   src/components/ProductCard.tsx  2",
        "  LegacyButton  @acme/ui-legacy                 2",
        "  Card          @acme/ui                        2",
        "  Header        src/components/Header.tsx       2",
        "",
        "",
      ].join("\n"),
    );
  });

  it("uses singulars for one, names a tag in angle brackets, and has no unmatched line when every occurrence matched", () => {
    const printed = capture([component("a", { kind: "tag", tagName: "acme-badge" }, 1)], {
      filesScanned: 1, scanDurationMs: 0, componentCount: 1, occurrenceCount: 1, resolvedOccurrenceCount: 1,
    });
    expect(printed).toBe("Scanned 1 file in 0.0s: 1 component, 1 occurrence.\n\nMost used:\n  <acme-badge>    1\n\n");
  });

  it("names a package's default export the way the dashboard does", () => {
    const printed = capture([component("a", packageExport("next", "default", "link"), 3)], {
      filesScanned: 1, scanDurationMs: 0, componentCount: 1, occurrenceCount: 3, resolvedOccurrenceCount: 3,
    });
    expect(printed).toContain("  link  next  3\n");
  });

  it("has no list when no component was used", () => {
    expect(capture([component("a", declaredIn("src/App.tsx", "App"), 0)], {
      filesScanned: 1, scanDurationMs: 0, componentCount: 1, occurrenceCount: 0, resolvedOccurrenceCount: 0,
    })).toBe("Scanned 1 file in 0.0s: 1 component, 0 occurrences.\n\n");
  });
});
