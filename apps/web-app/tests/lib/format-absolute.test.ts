import { describe, expect, it } from "vitest";
import { formatAbsoluteUtc } from "@/lib/format-absolute";

describe("formatAbsoluteUtc", () => {
  it("formats an ISO instant as UTC", () => {
    expect(formatAbsoluteUtc("2026-07-30T14:12:33.000Z")).toBe("2026-07-30 14:12 UTC");
  });

  it("normalises offset inputs to UTC", () => {
    expect(formatAbsoluteUtc("2026-07-30T16:12:00+02:00")).toBe("2026-07-30 14:12 UTC");
  });

  it("pads single-digit fields", () => {
    expect(formatAbsoluteUtc("2026-01-05T03:07:00.000Z")).toBe("2026-01-05 03:07 UTC");
  });
});
