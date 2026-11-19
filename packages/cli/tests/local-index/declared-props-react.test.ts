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

const PT = "import PropTypes from 'prop-types';";

describe("extractReactDeclaredProps: propTypes and defaultProps", () => {
  it("reads propTypes as the props of a component whose parameter isn't destructured", () => {
    const declared = extract("/repo/src/badge.jsx", [
      PT,
      "export function Badge(props) { return <span>{props.label}</span>; }",
      "Badge.propTypes = { label: PropTypes.string.isRequired, tone: PropTypes.oneOf(['info', 'warn']), 'aria-label': PropTypes.string };",
    ]);
    expect(declared.get("Badge")).toEqual({
      props: { label: { required: true }, tone: { required: false }, "aria-label": { required: false } },
      hasRest: false,
    });
  });

  it("merges propTypes with a destructured parameter: the union of names, destructured first", () => {
    const declared = extract("/repo/src/card.jsx", [
      PT,
      "export const Card = ({ title, elevated = true }) => <div/>;",
      "Card.propTypes = { elevated: PropTypes.bool.isRequired, footer: PropTypes.node, title: PropTypes.string.isRequired };",
    ]);
    const card = declared.get("Card");
    expect(Object.keys(card?.props ?? {})).toEqual(["title", "elevated", "footer"]);
    expect(card).toEqual({
      // A destructured default keeps `elevated` optional, whatever propTypes says.
      props: { title: { required: true }, elevated: { required: false, default: true }, footer: { required: false } },
      hasRest: false,
    });
  });

  it("takes a default from defaultProps when the parameter doesn't set one", () => {
    const declared = extract("/repo/src/button.jsx", [
      PT,
      "export default function Button({ size, variant = 'primary', onClick }) { return <button/>; }",
      "Button.propTypes = { size: PropTypes.string, variant: PropTypes.string, tone: PropTypes.string, icon: PropTypes.node };",
      "Button.defaultProps = { size: 'md', variant: 'secondary', tone: null, icon: <i/>, extra: 1 };",
    ]);
    expect(declared.get("Button")).toEqual({
      props: {
        size: { required: false, default: "md" },
        // The destructured default wins.
        variant: { required: false, default: "primary" },
        onClick: {},
        tone: { required: false, default: null },
        // A non-literal default: optional, no value. `extra` names no prop.
        icon: { required: false },
      },
      hasRest: false,
    });
  });

  it("applies defaultProps to a destructured component without propTypes", () => {
    const declared = extract("/repo/src/tag.jsx", ["export const Tag = ({ tone }) => <b/>;", "Tag.defaultProps = { tone: 'info' };"]);
    expect(declared.get("Tag")).toEqual({ props: { tone: { required: false, default: "info" } }, hasRest: false });
  });

  it("keeps a destructured non-literal default over a defaultProps value", () => {
    const declared = extract("/repo/src/list.jsx", ["export const List = ({ items = [] }) => <ul/>;", "List.defaultProps = { items: null };"]);
    expect(declared.get("List")?.props).toEqual({ items: { required: false } });
  });

  it("reads propTypes on a class component, assigned or static", () => {
    const assigned = extract("/repo/src/modal.jsx", [
      PT,
      "import React from 'react';",
      "export default class Modal extends React.Component { render() { return null; } }",
      "Modal.propTypes = { open: PropTypes.bool.isRequired };",
      "Modal.defaultProps = { open: false };",
    ]);
    expect(assigned.get("Modal")).toEqual({ props: { open: { required: false, default: false } }, hasRest: false });
    const staticFields = extract("/repo/src/dialog.jsx", [
      PT,
      "export class Dialog extends React.Component {",
      "  static propTypes = { title: PropTypes.string.isRequired, size: PropTypes.string };",
      "  static defaultProps = { size: 'md' };",
      "  render() { return null; }",
      "}",
    ]);
    expect(staticFields.get("Dialog")).toEqual({ props: { title: { required: true }, size: { required: false, default: "md" } }, hasRest: false });
  });

  it("reads propTypes through a const, a one-argument wrapper call, parentheses and a TS cast", () => {
    const declared = extract("/repo/src/field.tsx", [
      PT,
      "const propTypes = { label: (PropTypes.string.isRequired), hint: PropTypes.string as any };",
      "export const Field = (props: object) => <input/>;",
      "Field.propTypes = forbidExtraProps(propTypes);",
    ]);
    expect(declared.get("Field")).toEqual({ props: { label: { required: true }, hint: { required: false } }, hasRest: false });
  });

  it("leaves required absent for a value it can't read as a prop-types validator", () => {
    const declared = extract("/repo/src/x.jsx", [
      PT,
      "export const X = (props) => <b/>;",
      "X.propTypes = { title: shared.title, check: (props, name) => null, named: PropTypes.string };",
    ]);
    expect(declared.get("X")?.props).toEqual({ title: {}, check: {}, named: { required: false } });
  });

  it("reads named prop-types imports as validators", () => {
    const declared = extract("/repo/src/x.jsx", ["import { string, oneOf } from 'prop-types';", "export const X = (props) => <b/>;", "X.propTypes = { a: string, b: oneOf(['x']) };"]);
    expect(declared.get("X")?.props).toEqual({ a: { required: false }, b: { required: false } });
  });

  it.each([
    ["a spread or computed key in propTypes", ["export const F = (props) => <input/>;", "F.propTypes = { ...Input.propTypes, label: PropTypes.string, [key]: PropTypes.any };"]],
    ["a rest-only destructure", ["export const F = ({ ...rest }) => <input {...rest}/>;", "F.propTypes = { label: PropTypes.string };"]],
    ["a function that spreads its props", ["export const F = (props) => <input {...props}/>;", "F.propTypes = { label: PropTypes.string };"]],
    ["a class that spreads this.props", ["export class F extends React.Component { render() { return <input {...this.props}/>; } }", "F.propTypes = { label: PropTypes.string };"]],
    ["a later propTypes it can't read", ["export const F = ({ size }) => <input/>;", "F.propTypes = { label: PropTypes.string };", "F.propTypes = makeShared();"]],
  ])("sets hasRest for %s", (_, lines) => {
    const f = extract("/repo/src/f.jsx", [PT, ...lines]).get("F");
    expect(f?.hasRest).toBe(true);
  });

  it("keeps prop names that match Object.prototype members", () => {
    const declared = extract("/repo/src/x.jsx", [
      PT,
      "export const X = (props) => <b/>;",
      "X.propTypes = { constructor: PropTypes.string.isRequired, toString: PropTypes.string, ['__proto__']: PropTypes.string };",
      "X.defaultProps = { toString: 'x' };",
    ]);
    expect(Object.keys(declared.get("X")?.props ?? {})).toEqual(["constructor", "toString"]);
    expect(declared.get("X")?.props.constructor).toEqual({ required: true });
    expect(({} as Record<string, unknown>).required).toBeUndefined();
  });

  it.each([
    ["a name that isn't a top-level component", ["const config = {};", "config.propTypes = { a: PropTypes.string };"], "config"],
    ["defaultProps alone", ["export const Tag = (props) => <b/>;", "Tag.defaultProps = { tone: 'info' };"], "Tag"],
    ["propTypes it can't read and no destructure", ["export const Tag = (props) => <b/>;", "Tag.propTypes = shared;"], "Tag"],
    ["propTypes set inside a function", ["export const Tag = (props) => <b/>;", "function setup() { Tag.propTypes = { a: PropTypes.string }; }"], "Tag"],
  ])("reads nothing from %s", (_, lines, symbol) => {
    expect(extract("/repo/src/x.jsx", lines).get(symbol)).toBeUndefined();
  });
});
