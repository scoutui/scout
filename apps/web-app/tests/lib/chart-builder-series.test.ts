import { describe, expect, it } from "vitest";
import type { CohortSelector } from "@scoutui/web-shared";
import { deprecatedShare, deprecatedShareText, offersDeprecatedOnly, tagsInUse, type LibraryTag } from "@/lib/chart-builder-series";
import type { PickableComponent } from "@/components/dashboards/series-picker";

const comp = (componentId: string, packageName: string | null, deprecated = false): PickableComponent =>
  ({ componentId, displayName: componentId, packageName, deprecated });
const vueKits: LibraryTag = { id: "t-vue", label: "vue-ui-kits", color: "#888", rule: { glob: ["ant-design-vue*"], exact: ["naive-ui"] } };
const reactKits: LibraryTag = { id: "t-react", label: "react-ui-kits", color: "#888", rule: { glob: [], exact: ["@mui/material"] } };
const components = [
  comp("a", "ant-design-vue", true),
  comp("b", "ant-design-vue"),
  comp("c", "naive-ui", true),
  comp("d", "naive-ui"),
  comp("e", "@mui/material"),
  comp("f", null),
];

describe("deprecatedShare", () => {
  it("counts a package's components and its deprecated ones", () => {
    expect(deprecatedShare({ kind: "package", packageName: "naive-ui" }, components, [vueKits])).toEqual({ deprecated: 1, total: 2 });
  });
  it("counts every component whose package the tag covers", () => {
    expect(deprecatedShare({ kind: "tag", tagId: "t-vue" }, components, [vueKits, reactKits])).toEqual({ deprecated: 2, total: 4 });
  });
  it("counts nothing for a tag it doesn't know", () => {
    expect(deprecatedShare({ kind: "tag", tagId: "gone" }, components, [vueKits])).toEqual({ deprecated: 0, total: 0 });
  });
});

describe("offersDeprecatedOnly", () => {
  const off: CohortSelector & { kind: "tag" } = { kind: "tag", tagId: "t-vue" };
  const on = { ...off, deprecatedOnly: true };
  it.each([
    ["some deprecated", off, { deprecated: 2, total: 4 }, true],
    ["nothing deprecated", off, { deprecated: 0, total: 4 }, false],
    ["all deprecated", off, { deprecated: 4, total: 4 }, false],
    ["no components", off, { deprecated: 0, total: 0 }, false],
    ["already on, nothing deprecated", on, { deprecated: 0, total: 4 }, true],
    ["already on, all deprecated", on, { deprecated: 4, total: 4 }, true],
  ] as const)("%s", (_, sel, share, expected) => {
    expect(offersDeprecatedOnly(sel, share)).toBe(expected);
  });
});

describe("deprecatedShareText", () => {
  it.each([
    [{ deprecated: 11, total: 27 }, "11 of 27 components in vue-ui-kits are deprecated"],
    [{ deprecated: 1, total: 27 }, "1 of 27 components in vue-ui-kits is deprecated"],
    [{ deprecated: 1, total: 1 }, "1 of 1 component in vue-ui-kits is deprecated"],
    [{ deprecated: 0, total: 0 }, null],
  ] as const)("%o", (share, expected) => {
    expect(deprecatedShareText(share, "vue-ui-kits")).toBe(expected);
  });
});

describe("tagsInUse", () => {
  it("keeps the tags that cover a listed component's package", () => {
    expect(tagsInUse([vueKits, reactKits], [comp("c", "naive-ui"), comp("f", null)])).toEqual([vueKits]);
  });
  it("keeps none when no component has a tagged package", () => {
    expect(tagsInUse([vueKits, reactKits], [comp("f", null)])).toEqual([]);
  });
});
