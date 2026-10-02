import { describe, it, expect } from "vitest";
import {
  buildIdentityGroups,
  filterIdentityGroups,
  MAX_EXPORTS_PER_GROUP,
  MAX_GROUPS,
} from "@/lib/identity-groups";

const sources = [
  { packageName: "@old-ds/core", exportName: "Button" },
  { packageName: "@old-ds/core", exportName: "ButtonLink" },
  { packageName: "@old-ds/core", exportName: "Card" },
  { packageName: "@old-ds/core", exportName: "Button" }, // duplicate collapses
  { packageName: "@new-ds/react", exportName: "Button" },
  { packageName: "entry-only-pkg" }, // package with no component entries
];

describe("buildIdentityGroups", () => {
  it("groups by package with sorted, de-duplicated exports; packages sorted", () => {
    const groups = buildIdentityGroups(sources);
    expect(groups.map((g) => g.packageName)).toEqual(["@new-ds/react", "@old-ds/core", "entry-only-pkg"]);
    expect(groups[1]?.exports).toEqual(["Button", "ButtonLink", "Card"]);
    expect(groups[2]?.exports).toEqual([]);
  });
});

describe("filterIdentityGroups", () => {
  const groups = buildIdentityGroups(sources);

  it("empty query returns all groups uncapped by matching (still group-capped)", () => {
    const r = filterIdentityGroups(groups, "");
    expect(r.groups).toHaveLength(3);
    expect(r.hiddenGroups).toBe(0);
  });

  it("terms AND-match across package and export, order-independent, case-insensitive", () => {
    const a = filterIdentityGroups(groups, "old button");
    const b = filterIdentityGroups(groups, "BUTTON old");
    expect(a.groups.map((g) => g.packageName)).toEqual(["@old-ds/core"]);
    expect(a.groups[0]?.exports).toEqual(["Button", "ButtonLink"]);
    expect(b.groups).toEqual(a.groups);
  });

  it("a package-name match exposes the whole group's exports", () => {
    const r = filterIdentityGroups(groups, "old-ds");
    expect(r.groups[0]?.exports).toEqual(["Button", "ButtonLink", "Card"]);
  });

  it("no match returns empty", () => {
    expect(filterIdentityGroups(groups, "zzz").groups).toEqual([]);
  });

  it("caps exports per group and reports hidden + total counts", () => {
    const big = buildIdentityGroups(
      Array.from({ length: 160 }, (_, i) => ({ packageName: "icons", exportName: `Icon${String(i).padStart(3, "0")}` })),
    );
    const r = filterIdentityGroups(big, "icon");
    expect(r.groups[0]?.exports).toHaveLength(MAX_EXPORTS_PER_GROUP);
    expect(r.groups[0]?.hiddenExports).toBe(160 - MAX_EXPORTS_PER_GROUP);
    expect(r.groups[0]?.totalExports).toBe(160);
  });

  it("caps rendered groups and reports the hidden group count", () => {
    const many = buildIdentityGroups(Array.from({ length: 20 }, (_, i) => ({ packageName: `pkg-${String(i).padStart(2, "0")}` })));
    const r = filterIdentityGroups(many, "");
    expect(r.groups).toHaveLength(MAX_GROUPS);
    expect(r.hiddenGroups).toBe(20 - MAX_GROUPS);
  });
});
