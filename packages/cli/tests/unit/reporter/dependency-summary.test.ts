import { describe, it, expect, vi } from "vitest";
import { buildScanStats } from "../../../src/artifact/scan-stats.js";
import type { Occurrence, ScanArtifact } from "@scoutui/scan-format";
import { formatWarning } from "../../../src/reporter/diagnostic-lines.js";
import { printSummary } from "../../../src/reporter/stdout.js";
import { createColor } from "../../../src/util/style.js";

const occurrence = (resolution: Occurrence["resolution"], line: number): Occurrence => ({
  occurrenceId: `o${line}`,
  resolution,
  filePath: "src/App.tsx",
  line,
  column: 1,
  credit: { kind: "render" },
  trace: [],
  props: {},
});

const notInstalled = (packageName: string): Occurrence["resolution"] => ({
  status: "unresolved",
  reason: { kind: "package-not-installed", packageName },
});

const artifactOf = (occurrences: Occurrence[]): ScanArtifact => ({
  meta: {
    schemaVersion: 2,
    scannerVersion: "0.0.0-test",
    scanId: "01TEST000000000000000000000",
    scannedAt: "2026-05-07T00:00:00.000Z",
    repo: { id: "r", gitRemote: null, commit: "abc123", committedAt: "2026-05-06T12:00:00.000Z", initialCommit: null, branch: null },
  },
  components: [],
  occurrences,
  diagnostics: [],
});

function capture(out: ScanArtifact): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
    chunks.push(s);
    return true;
  }) as typeof process.stdout.write);
  const stats = buildScanStats({ filesScanned: 1, scanDurationMs: 0, components: out.components, occurrences: out.occurrences });
  printSummary(out, stats, createColor({ isTTY: false, env: {} }), { mostUsed: true });
  spy.mockRestore();
  return chunks.join("");
}

describe("missing dependency reporting", () => {
  it.each([
    [
      [occurrence(notInstalled("@example/ui"), 1), occurrence(notInstalled("@example/icons"), 2), occurrence(notInstalled("@example/ui"), 3), occurrence({ status: "unresolved", reason: { kind: "module-not-found" } }, 4)],
      "Scout couldn't match 4 more occurrences to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences\n3 of them are from packages that aren't installed.\n",
    ],
    [
      [occurrence(notInstalled("@example/ui"), 1)],
      "Scout couldn't match 1 more occurrence to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences\n1 of them is from a package that isn't installed.\n",
    ],
    [
      [occurrence(notInstalled("@example/ui"), 1), occurrence(notInstalled("@example/ui"), 2)],
      "Scout couldn't match 2 more occurrences to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences\n2 of them are from a package that isn't installed.\n",
    ],
  ])("says how many of the occurrences it couldn't match are from packages that aren't installed (%#)", (occurrences, lines) => {
    expect(capture(artifactOf(occurrences))).toBe(`Scanned 1 file in 0.0s: 0 components, 0 occurrences.\n${lines}\n`);
  });

  it.each([
    [2, "@example/ui is listed in apps/web/package.json but isn't installed, so 2 occurrences of it aren't matched to a component. Install your dependencies and scan again."],
    [1, "@example/ui is listed in apps/web/package.json but isn't installed, so 1 occurrence of it isn't matched to a component. Install your dependencies and scan again."],
  ])("logs the package, its occurrences (%i) and the declaring package.json", (occurrenceCount, line) => {
    expect(
      formatWarning({
        code: "dependency-not-installed",
        severity: "warning",
        packageName: "@example/ui",
        occurrenceCount,
        declaredIn: "apps/web/package.json",
      }),
    ).toBe(line);
  });
});
