/**
 * A render function call is a use: `createElement(Button, { size: "sm" })` from `react`, and
 * `h(Button, { size: "sm" })` from `vue`, pass `size` to `Button` as surely as `<Button size="sm" />`
 * does. The props argument's keys are the props. A spread in it, or a props argument that isn't an
 * object literal, passes props Scout can't name, recorded as `...rest`.
 */
import { describe, expect, it } from "vitest";
import { relResolver, scanGraph } from "./shape-helpers.js";

const BUTTON = "export const Button = (p: { size?: string; label?: string; children?: unknown }) => null;";

/** Each occurrence of `Button` in `src/use.ts`, as [line, props], in source order. */
function usesOf(body: string) {
  const { occurrences } = scanGraph({ "src/Button.tsx": BUTTON, "src/use.ts": `import { Button } from "./Button";\n${body}` }, relResolver("/repo"), "/repo");
  return occurrences.filter((o) => o.filePath === "src/use.ts").map((o) => o.props);
}

const SM = { size: { tier: "written", value: "sm" } };
const REST = { "...rest": { tier: "dynamic" } };

describe("render calls as uses", () => {
  it.each([
    ["createElement from react", `import { createElement } from "react";\nexport const make = () => createElement(Button, { size: "sm" });`],
    ["an aliased createElement", `import { createElement as ce } from "react";\nexport const make = () => ce(Button, { size: "sm" });`],
    ["React.createElement on a default import", `import React from "react";\nexport const make = () => React.createElement(Button, { size: "sm" });`],
    ["createElement on a namespace import", `import * as R from "react";\nexport const make = () => R.createElement(Button, { size: "sm" });`],
    ["h from vue", `import { h } from "vue";\nexport const make = () => h(Button, { size: "sm" });`],
    ["h from vue-demi", `import { h } from "vue-demi";\nexport const make = () => h(Button, { size: "sm" });`],
    ["h from @vue/runtime-core", `import { h } from "@vue/runtime-core";\nexport const make = () => h(Button, { size: "sm" });`],
  ])("records the props of %s", (_, body) => {
    expect(usesOf(body)).toEqual([SM]);
  });

  it("reads each key the way an attribute is read", () => {
    const body = `import { h } from "vue";\nexport const make = (label: string, user: { name: string }, on: boolean) => h(Button, { label, "size": on ? "sm" : "lg", title: user.name, onClick: () => {}, class: "x" });`;
    expect(usesOf(body)).toEqual([
      {
        label: { tier: "reference", ref: "label" },
        size: { tier: "written", valueSet: ["sm", "lg"] },
        title: { tier: "reference", ref: "user.name" },
        onClick: { tier: "dynamic" },
        class: { tier: "written", value: "x" },
      },
    ]);
  });

  it.each([
    ["a spread in the object", `import { h } from "vue";\nexport const make = (rest: object) => h(Button, { size: "sm", ...rest });`, { ...SM, ...REST }],
    ["a computed key", `import { h } from "vue";\nexport const make = (k: string) => h(Button, { [k]: 1 });`, REST],
    ["an identifier props argument", `import { h } from "vue";\nexport const make = (props: object) => h(Button, props);`, REST],
    ["a call as the props argument", `import { createElement } from "react";\nexport const make = (f: () => object) => createElement(Button, f());`, REST],
  ])("records ...rest for %s", (_, body, props) => {
    expect(usesOf(body)).toEqual([props]);
  });

  it.each([
    ["no props argument", `import { h } from "vue";\nexport const make = () => h(Button);`],
    ["null", `import { createElement } from "react";\nexport const make = () => createElement(Button, null);`],
    ["an empty object", `import { h } from "vue";\nexport const make = () => h(Button, {});`],
    ["void 0", `import { createElement } from "react";\nexport const make = () => createElement(Button, void 0);`],
    ["a cast null", `import { createElement } from "react";\nexport const make = () => createElement(Button, null as any);`],
    ["a Vue default-slot function", `import { h } from "vue";\nexport const make = () => h(Button, () => "Save");`],
    ["a Vue children array", `import { h } from "vue";\nexport const make = () => h(Button, [h("span")]);`],
    ["a Vue text child", `import { h } from "vue";\nexport const make = () => h(Button, "Save");`],
    ["a Vue template-literal child", "import { h } from \"vue\";\nexport const make = (n: number) => h(Button, `${n} items`);"],
  ])("records no props for %s", (_, body) => {
    expect(usesOf(body)).toEqual([{}]);
  });

  it("records a React call's later arguments as children, but not a Vue call's", () => {
    const react = `import { createElement } from "react";\nexport const make = () => createElement(Button, null, "Save");`;
    const vue = `import { h } from "vue";\nexport const make = () => h(Button, null, () => "Save");`;
    expect(usesOf(react)).toEqual([{ children: { tier: "dynamic" } }]);
    expect(usesOf(vue)).toEqual([{}]);
  });

  it("records no children for a React call whose later arguments pass nothing", () => {
    expect(usesOf(`import { createElement } from "react";\nexport const make = () => createElement(Button, null, null as any, undefined);`)).toEqual([{}]);
  });

  it("records a use of a component on a lowercase namespace, as JSX does", () => {
    const { occurrences } = scanGraph(
      {
        "src/Button.tsx": BUTTON,
        "src/use.ts": `import * as ui from "./Button";\nimport { createElement } from "react";\nexport const make = () => createElement(ui.Button, { size: "sm" });`,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(occurrences.filter((o) => o.filePath === "src/use.ts").map((o) => o.props)).toEqual([SM]);
  });

  it("skips Vue built-ins imported from vue-demi", () => {
    expect(usesOf(`import { h, Transition } from "vue-demi";\nexport const make = () => h(Transition, { name: "fade" });`)).toEqual([]);
  });

  it.each([
    ["h from another package", `import { h } from "preact";\nexport const make = () => h(Button, { size: "sm" });`],
    ["a local h", `const h = (c: unknown, p: unknown) => null;\nexport const make = () => h(Button, { size: "sm" });`],
    ["an import shadowed by a parameter", `import { h } from "vue";\nexport const make = (h: (c: unknown, p: unknown) => null) => h(Button, { size: "sm" });`],
    ["document.createElement", "export const make = (tag: string) => document.createElement(tag);"],
    ["a string tag", `import { h } from "vue";\nexport const make = () => h("div", { size: "sm" });`],
    ["a Vue built-in", `import { h, Fragment, Transition } from "vue";\nexport const make = () => [h(Fragment, []), h(Transition, { name: "fade" })];`],
  ])("records no use for %s", (_, body) => {
    expect(usesOf(body)).toEqual([]);
  });
});
