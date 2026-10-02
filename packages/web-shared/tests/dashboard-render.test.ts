import { describe, it, expect } from "vitest";
import type { GovernanceRecord, Tag } from "../src/dto.js";
import { renderDashboard } from "../src/dashboard-render.js";
import { artifact, component, packageExport, received, resolvedAt } from "./helpers/builders.js";

const webTag: Tag = { id: "web", value: "web", category: "library", color: "#7c3aed", rule: { glob: ["@x/web-*"], exact: [] } };
const webButton = component(packageExport("@x/web-webc", "WebButton"));

describe("renderDashboard", () => {
  const arts = [received(artifact({
    repoId: "r1",
    scanId: "r1:2026-01-01T00:00:00Z",
    scannedAt: "2026-01-01T00:00:00Z",
    components: [webButton],
    occurrences: Array.from({ length: 10 }, (_, i) => resolvedAt(webButton, "src/app.tsx", i + 1)),
  }))];
  const digests = arts;

  it("returns a snapshot for a snapshot chartType (bars)", () => {
    const view = renderDashboard({ scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "bars", metric: "count" }, digests, [webTag]);
    expect(view.kind).toBe("snapshot");
    if (view.kind === "snapshot") expect(view.points[0]!.value).toBe(10);
  });

  it("renders stacked-share as a series, forcing the share metric", () => {
    const view = renderDashboard({ scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "stacked-share", metric: "count" }, digests, [webTag]);
    expect(view.kind).toBe("series");
    if (view.kind === "series") expect(view.series[0]!.points[0]!.value).toBe(1); // 10/10 → share, not count
  });

  it("renders table as snapshot + series joined", () => {
    const view = renderDashboard({ scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "table", metric: "count" }, digests, [webTag]);
    expect(view.kind).toBe("table");
    if (view.kind === "table") {
      expect(view.points[0]!.value).toBe(10);
      expect(view.series[0]!.points[0]!.value).toBe(10);
    }
  });

  it("returns a series for trend chartType", () => {
    const view = renderDashboard({ scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "trend", metric: "count" }, digests, [webTag]);
    expect(view.kind).toBe("series");
    if (view.kind === "series") expect(view.series[0]!.points[0]!.value).toBe(10);
  });

  it("narrows a package cohort to deprecated components when governance is passed", () => {
    const gov: GovernanceRecord[] = [
      { id: "gr1", grain: "package", targetPackage: "@x/web-webc", targetExport: null, disposition: { kind: "retired", reason: "legacy" }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    ];
    const view = renderDashboard(
      { scope: { kind: "all" }, cohorts: [{ kind: "package", packageName: "@x/web-webc", deprecatedOnly: true }], chartType: "bars", metric: "count" },
      digests,
      [webTag],
      gov,
    );
    expect(view.kind).toBe("snapshot");
    if (view.kind === "snapshot") expect(view.points[0]!.value).toBe(10);
  });
});
