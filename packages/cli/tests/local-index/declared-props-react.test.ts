import { describe, it, expect } from "vitest";
import { parseByExt } from "../../src/parse-by-ext.js";
import { extractReactDeclaredProps } from "../../src/local-index/declared-props.js";

function extract(filePath: string, lines: string[]) {
  const parsed = parseByExt(filePath, lines.join("\n"));
  if (parsed.kind !== "babel") throw new Error(`expected babel kind, got ${parsed.kind}`);
  return extractReactDeclaredProps(parsed.ast);
}

describe("extractReactDeclaredProps: the declared prop API", () => {
  it("captures declared props + defaults + rest from a function component", () => {
    const declared = extract("/repo/src/button.tsx", [
      "export function Button({ variant = \"primary\", size, disabled = false, ...rest }) {",
      "  return <button/>;",
      "}",
    ]);
    expect(declared.get("Button")).toEqual({
      props: {
        variant: { required: false, default: "primary" },
        size: {},
        disabled: { required: false, default: false },
      },
      hasRest: true,
    });
  });

  it("captures declared props even when the param has an imported type annotation", () => {
    const declared = extract("/repo/src/card.tsx", [
      "import type { Props } from './props';",
      "export const Card = ({ title, elevated = true }: Props) => <div/>;",
    ]);
    expect(declared.get("Card")?.props).toEqual({ title: {}, elevated: { required: false, default: true } });
  });

  it("reads props through a forwardRef wrapper's first param", () => {
    const declared = extract("/repo/src/input.tsx", [
      "import { forwardRef } from 'react';",
      "const Input = forwardRef(({ value, big = false }, ref) => <input ref={ref}/>);",
      "export default Input;",
    ]);
    expect(declared.get("Input")?.props).toEqual({ value: {}, big: { required: false, default: false } });
  });

  it("reads props through a memo wrapper's first param", () => {
    const declared = extract("/repo/src/badge.tsx", [
      "import { memo } from 'react';",
      "export const Badge = memo(function ({ tone }) { return <b/>; });",
    ]);
    expect(declared.get("Badge")?.props).toEqual({ tone: {} });
  });

  it("omits a component that takes a non-destructured props param", () => {
    const declared = extract("/repo/src/raw.tsx", ["export function Raw(props) { return <div>{props.x}</div>; }"]);
    expect(declared.has("Raw")).toBe(false);
  });

  it("extracts nothing from a TypeScript cast in a .ts file, without throwing", () => {
    const declared = extract("/repo/src/routes.ts", [
      "export const getRoutes = () => {",
      "  return <const>{",
      "    header: 'X',",
      "    available: true,",
      "  };",
      "};",
    ]);
    expect([...declared.keys()]).toEqual([]);
  });
});

describe("extractReactDeclaredProps: no judgement about what is a component", () => {
  it("extracts a declaration nothing exports", () => {
    const declared = extract("/repo/src/panel.tsx", ["const Panel = ({ title }) => <section>{title}</section>;"]);
    expect(declared.get("Panel")).toEqual({ props: { title: {} }, hasRest: false });
  });

  it("extracts a lowercase helper", () => {
    const declared = extract("/repo/src/rows.tsx", [
      "function renderRow({ id, label = \"none\" }) { return <li key={id}>{label}</li>; }",
    ]);
    expect(declared.get("renderRow")).toEqual({
      props: { id: {}, label: { required: false, default: "none" } },
      hasRest: false,
    });
  });

  it("extracts a function that returns null", () => {
    const declared = extract("/repo/src/empty.tsx", ["export function Empty({ when }) { return null; }"]);
    expect(declared.get("Empty")).toEqual({ props: { when: {} }, hasRest: false });
  });

  it("reads props through a wrapper nested in another wrapper", () => {
    const declared = extract("/repo/src/field.tsx", [
      "import { memo, forwardRef } from 'react';",
      "export const Field = memo(forwardRef(({ name, size = \"m\" }, ref) => <input name={name} ref={ref}/>));",
    ]);
    expect(declared.get("Field")).toEqual({
      props: { name: {}, size: { required: false, default: "m" } },
      hasRest: false,
    });
  });

  it("keys an anonymous default export as `default`", () => {
    expect(extract("/repo/src/a.tsx", ["export default ({ size = 2 }) => <div/>;"]).get("default")).toEqual({
      props: { size: { required: false, default: 2 } },
      hasRest: false,
    });
    expect(extract("/repo/src/b.tsx", ["export default function ({ open }) { return <div/>; }"]).get("default")).toEqual({
      props: { open: {} },
      hasRest: false,
    });
    expect(
      extract("/repo/src/c.tsx", ["import { memo } from 'react';", "export default memo(({ items }) => <ul/>);"]).get("default"),
    ).toEqual({ props: { items: {} }, hasRest: false });
  });

  it("keys a named default export by its own name", () => {
    const declared = extract("/repo/src/page.tsx", ["export default function Page({ slug }) { return <main/>; }"]);
    expect([...declared.keys()]).toEqual(["Page"]);
  });
});
