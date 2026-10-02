import { describe, expect, it } from "vitest";
import type { CohortSelector } from "@scoutui/web-shared";
import { seriesCanOverlap } from "@/lib/cohort-overlap";
import type { LibraryTag } from "@/lib/chart-builder-series";

const tag = (id: string, exact: string[]): LibraryTag => ({ id, label: id, color: "#888", rule: { glob: [], exact } });
const context = {
  components: [
    { componentId: "btn", displayName: "Button", packageName: "@x/ui", deprecated: false },
    { componentId: "card", displayName: "Card", packageName: "@x/legacy", deprecated: false },
  ],
  packages: ["@x/ui", "@x/legacy", "@x/icons"],
  tags: [tag("ui", ["@x/ui"]), tag("legacy", ["@x/legacy"]), tag("all", ["@x/ui", "@x/legacy"])],
};
const pkg = (packageName: string): CohortSelector => ({ kind: "package", packageName });
const t = (tagId: string): CohortSelector => ({ kind: "tag", tagId });
const c = (componentId: string): CohortSelector => ({ kind: "component", componentId });

describe("seriesCanOverlap", () => {
  it.each<[string, CohortSelector[], boolean]>([
    ["a single series", [t("ui")], false],
    ["different packages", [pkg("@x/ui"), pkg("@x/legacy"), pkg("@x/icons")], false],
    ["different components", [c("btn"), c("card")], false],
    ["a component and another package", [c("btn"), pkg("@x/legacy")], false],
    ["a component and its package", [c("btn"), pkg("@x/ui")], true],
    ["a component and a tag over its package", [c("btn"), t("ui")], true],
    ["a component and a tag over other packages", [c("btn"), t("legacy")], false],
    ["a tag and a package it covers", [t("ui"), pkg("@x/ui")], true],
    ["a tag and a package it doesn't cover", [t("ui"), pkg("@x/icons")], false],
    ["tags sharing a package", [t("ui"), t("all")], true],
    ["tags with no package in common", [t("ui"), t("legacy")], false],
    ["Local and a package", [{ kind: "local" }, pkg("@x/icons")], true],
    ["a tag the lists don't know", [t("gone"), pkg("@x/icons")], true],
    ["a component the lists don't know", [c("gone"), pkg("@x/icons")], true],
  ])("%s", (_, cohorts, expected) => {
    expect(seriesCanOverlap(cohorts, context)).toBe(expected);
  });
});
