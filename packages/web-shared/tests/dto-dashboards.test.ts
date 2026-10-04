import { describe, it, expect } from "vitest";
import {
  CohortPointSchema,
  CohortSeriesSchema,
  CohortSelectorSchema,
  DashboardConfigSchema,
  DashboardInputSchema,
  DashboardSchema,
} from "../src/dto.js";

describe("CohortSelectorSchema", () => {
  it("accepts each selector kind", () => {
    expect(CohortSelectorSchema.parse({ kind: "tag", tagId: "t1" }).kind).toBe("tag");
    expect(CohortSelectorSchema.parse({ kind: "package", packageName: "@x/lib" }).kind).toBe("package");
    expect(CohortSelectorSchema.parse({ kind: "component", componentId: "c1" }).kind).toBe("component");
    expect(CohortSelectorSchema.parse({ kind: "local" }).kind).toBe("local");
  });

  it("rejects an unknown kind", () => {
    expect(() => CohortSelectorSchema.parse({ kind: "team", teamId: "x" })).toThrow();
  });

  it("rejects a tag selector missing tagId", () => {
    expect(() => CohortSelectorSchema.parse({ kind: "tag" })).toThrow();
  });
});

describe("DashboardConfigSchema", () => {
  it("requires at least one cohort", () => {
    expect(() =>
      DashboardConfigSchema.parse({ scope: { kind: "all" }, cohorts: [], chartType: "bars", metric: "count" }),
    ).toThrow();
  });

  it("parses a valid repo-scoped config", () => {
    const cfg = DashboardConfigSchema.parse({
      scope: { kind: "repo", repoId: "example-web" },
      cohorts: [{ kind: "tag", tagId: "web" }, { kind: "local" }],
      chartType: "stacked-share",
      metric: "share",
    });
    expect(cfg.scope).toEqual({ kind: "repo", repoId: "example-web" });
    expect(cfg.cohorts).toHaveLength(2);
  });
});

describe("DashboardInputSchema", () => {
  it("allows omitting id (driver generates it)", () => {
    const input = DashboardInputSchema.parse({
      name: "web vs legacy",
      description: null,
      config: { scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "trend", metric: "count" },
      visibility: "only-me",
    });
    expect(input.id).toBeUndefined();
  });
});

describe("DashboardSchema", () => {
  it("parses a fully hydrated dashboard (read shape)", () => {
    const d = DashboardSchema.parse({
      id: "d1",
      name: "web vs legacy",
      description: null,
      config: { scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "trend", metric: "count" },
      visibility: "everyone",
      createdByUserId: null,
      createdBy: null,
      createdAt: "2026-06-04T00:00:00Z",
      updatedAt: "2026-06-04T00:00:00Z",
    });
    expect(d.id).toBe("d1");
    expect(d.createdByUserId).toBeNull();
  });
});

describe("CohortSelectorSchema: deprecatedOnly and the filter kind", () => {
  it("accepts deprecatedOnly on package and tag", () => {
    expect(CohortSelectorSchema.parse({ kind: "package", packageName: "@x/ui", deprecatedOnly: true })).toMatchObject({ deprecatedOnly: true });
    expect(CohortSelectorSchema.parse({ kind: "tag", tagId: "web", deprecatedOnly: true })).toMatchObject({ deprecatedOnly: true });
  });
  it("treats deprecatedOnly as optional", () => {
    expect(CohortSelectorSchema.parse({ kind: "package", packageName: "@x/ui" })).toEqual({ kind: "package", packageName: "@x/ui" });
  });
  it("rejects a filter cohort kind", () => {
    expect(() => CohortSelectorSchema.parse({ kind: "filter", conditions: [{ field: "kind", op: "is", values: ["react"] }] })).toThrow();
  });
});

describe("cohort role channel", () => {
  it("points and series accept an optional semantic role", () => {
    const point = CohortPointSchema.parse({
      cohortKey: "component:c1", label: "Button · legacy", color: "", value: 3, componentCount: 1,
      role: "deprecated",
    });
    expect(point.role).toBe("deprecated");
    const series = CohortSeriesSchema.parse({
      cohortKey: "package:@x/next", label: "@x/next", color: "", points: [], role: "successor",
    });
    expect(series.role).toBe("successor");
    // role is optional: a point without one parses
    expect(CohortPointSchema.parse({ cohortKey: "local", label: "local", color: "", value: 0, componentCount: 0 }).role).toBeUndefined();
  });

  it("selectors carry only the successor role (deprecated is derived, never authored)", () => {
    expect(CohortSelectorSchema.parse({ kind: "package", packageName: "@x/next", role: "successor" })).toEqual({
      kind: "package", packageName: "@x/next", role: "successor",
    });
    expect(CohortSelectorSchema.parse({ kind: "component", componentId: "c9", role: "successor" })).toEqual({
      kind: "component", componentId: "c9", role: "successor",
    });
    expect(() => CohortSelectorSchema.parse({ kind: "package", packageName: "@x/next", role: "deprecated" })).toThrow();
    expect(CohortSelectorSchema.parse({ kind: "local", role: "successor" })).toEqual({ kind: "local" });
  });
});
