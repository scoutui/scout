import { describe, it, expect } from "vitest";
import { shortScanId } from "@/lib/scan-id";

describe("shortScanId", () => {
  it("slices a ULID to 12 characters", () => {
    expect(shortScanId("01KRRX0E7G2J3K4M5N6P7Q8R9S")).toBe("01KRRX0E7G2J");
  });

  it("disambiguates close-in-time ULIDs that share an 8-char prefix", () => {
    // Seen in real scans: two scan ids sharing "01KRRX0E".
    const a = shortScanId("01KRRX0EAAAA0000000000000A");
    const b = shortScanId("01KRRX0EBBBB0000000000000B");
    expect(a).not.toBe(b);
  });

  it("returns short inputs unchanged", () => {
    expect(shortScanId("abc123")).toBe("abc123");
  });
});
