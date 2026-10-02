import { describe, it, expect } from "vitest";
import {
  scanHref,
  recentScanWindow,
  scanCountLabel,
  isOlderScan,
} from "@/lib/scan-switcher";

describe("scanHref", () => {
  it("links the latest scan to the bare repo URL", () => {
    expect(scanHref("my-repo", "01A", "01A")).toBe("/repos/my-repo");
  });

  it("links non-latest scans with an encoded ?scan param", () => {
    expect(scanHref("my-repo", "01B+x", "01A")).toBe("/repos/my-repo?scan=01B%2Bx");
  });

  it("URI-encodes repoIds containing slashes", () => {
    expect(scanHref("example-monorepo/web", "01A", "01A")).toBe(
      "/repos/example-monorepo%2Fweb",
    );
    expect(scanHref("example-monorepo/web", "01B", "01A")).toBe(
      "/repos/example-monorepo%2Fweb?scan=01B",
    );
  });
});

describe("recentScanWindow", () => {
  const scans = (...ids: string[]) => ids.map((scanId) => ({ scanId }));

  it("returns the first `limit` scans when the current scan is among them", () => {
    const result = recentScanWindow(scans("a", "b", "c"), "b", 2);
    expect(result.map((s) => s.scanId)).toEqual(["a", "b"]);
  });

  it("prepends the current scan when it falls outside the window", () => {
    const result = recentScanWindow(scans("a", "b", "c", "d"), "d", 2);
    expect(result.map((s) => s.scanId)).toEqual(["d", "a"]);
  });

  it("keeps the window size when prepending", () => {
    const result = recentScanWindow(scans("a", "b", "c", "d", "e"), "e", 3);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.scanId)).toEqual(["e", "a", "b"]);
  });

  it("does not prepend a current scan that isn't in the scan list at all", () => {
    const result = recentScanWindow(scans("a", "b"), "missing", 2);
    expect(result.map((s) => s.scanId)).toEqual(["a", "b"]);
  });
});

describe("scanCountLabel", () => {
  it("uses the singular for one scan", () => {
    expect(scanCountLabel(1)).toBe("1 scan");
  });

  it("uses the plural otherwise", () => {
    expect(scanCountLabel(0)).toBe("0 scans");
    expect(scanCountLabel(12)).toBe("12 scans");
  });
});

describe("isOlderScan", () => {
  it("is false when no scan was explicitly requested", () => {
    expect(isOlderScan(undefined, "01A", "01A")).toBe(false);
  });

  it("is false when there are no recent scans (latest unknown)", () => {
    expect(isOlderScan("01B", undefined, "01B")).toBe(false);
  });

  it("is false when the requested scan is the latest", () => {
    expect(isOlderScan("01A", "01A", "01A")).toBe(false);
  });

  it("is true only when an explicitly requested scan resolves to a non-latest scan", () => {
    expect(isOlderScan("01B", "01A", "01B")).toBe(true);
  });
});
