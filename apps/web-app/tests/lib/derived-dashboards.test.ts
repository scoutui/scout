import { describe, expect, it } from "vitest";
import { isDerivedId } from "@/lib/derived-dashboards";

describe("isDerivedId", () => {
  it("recognises governance-derived ids", () => {
    expect(isDerivedId("migration:abc123")).toBe(true);
    expect(isDerivedId("retirement:abc123")).toBe(true);
  });

  it("treats saved dashboards as editable", () => {
    expect(isDerivedId("user-chart-id")).toBe(false);
  });
});
