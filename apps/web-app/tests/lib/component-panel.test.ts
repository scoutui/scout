import { describe, expect, it } from "vitest";
import type { DigestScan, ScanSummary } from "@scoutui/web-shared";
import { componentHistory } from "@/lib/component-panel";

const day = (d: number) => `2026-09-${String(d).padStart(2, "0")}T10:00:00.000Z`;
const scan = (scanId: string, d: number, over: Partial<ScanSummary> = {}): ScanSummary => ({
  scanId, committedAt: day(d), arrivedAt: day(d), commit: scanId, branch: "main", uploadedBy: null, ready: true, ...over,
});
const holding = (scanId: string, occurrenceCount: number): DigestScan => ({
  meta: { scanId, committedAt: day(1), arrivedAt: day(1), repo: { id: "r1" } },
  components: [{ id: "c1", identity: { kind: "tag", tagName: "x-button" }, stats: { occurrenceCount } } as DigestScan["components"][number]],
});

describe("componentHistory", () => {
  it.each<[string, ScanSummary[], DigestScan[], string, { t: string; value: number }[]]>([
    ["counts 0 in a scan between that doesn't hold the component", [scan("s1", 1), scan("s2", 2), scan("s3", 3)], [holding("s1", 5), holding("s3", 7)], "s3",
      [{ t: day(1), value: 5 }, { t: day(2), value: 0 }, { t: day(3), value: 7 }]],
    ["starts at the first scan holding the component", [scan("s1", 1), scan("s2", 2), scan("s3", 3)], [holding("s2", 3), holding("s3", 4)], "s3",
      [{ t: day(2), value: 3 }, { t: day(3), value: 4 }]],
    ["ends at the shown scan", [scan("s1", 1), scan("s2", 2), scan("s3", 3)], [holding("s1", 1), holding("s2", 2), holding("s3", 3)], "s2",
      [{ t: day(1), value: 1 }, { t: day(2), value: 2 }]],
    ["leaves out scans that aren't ready", [scan("s1", 1), scan("s2", 2, { ready: false }), scan("s3", 3)], [holding("s1", 1), holding("s3", 3)], "s3",
      [{ t: day(1), value: 1 }, { t: day(3), value: 3 }]],
    ["places a scan at its arrival when that's before its commit date", [scan("s1", 1), scan("s2", 9, { arrivedAt: day(2) })], [holding("s1", 1), holding("s2", 2)], "s2",
      [{ t: day(1), value: 1 }, { t: day(2), value: 2 }]],
  ])("%s", (_title, oldestFirst, digests, shown, expected) => {
    expect(componentHistory([...oldestFirst].reverse(), digests, shown)).toEqual(expected);
  });
});
