import { describe, it, expect } from "vitest";
import { parseByExt } from "../../src/parse-by-ext.js";
import { extractReactDeclaredProps } from "../../src/local-index/declared-props.js";

function extract(filePath: string, lines: string[], reactMajor?: number | null) {
  const parsed = parseByExt(filePath, lines.join("\n"));
  if (parsed.kind !== "babel") throw new Error(`expected babel kind, got ${parsed.kind}`);
  return extractReactDeclaredProps(parsed.ast, reactMajor === undefined ? {} : { reactMajor });
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
        size: { hasDefault: false },
        disabled: { required: false, default: false },
      },
      hasRest: true,
    });
  });

  it("records each kind of destructured default", () => {
    const declared = extract("/repo/src/icon-button.tsx", [
      "export function IconButton({ icon = defaultIcon, size = theme.size, items = makeItems(), label = undefined, tone }) {",
      "  return <button/>;",
      "}",
    ]);
    expect(declared.get("IconButton")?.props).toEqual({
      icon: { required: false, hasDefault: true, defaultRef: "defaultIcon" },
      size: { required: false, hasDefault: true, defaultRef: "theme.size" },
      items: { required: false, hasDefault: true },
      label: { required: false, hasDefault: false },
      tone: { hasDefault: false },
    });
  });

  it("captures declared props even when the param has an imported type annotation", () => {
    const declared = extract("/repo/src/card.tsx", [
      "import type { Props } from './props';",
      "export const Card = ({ title, elevated = true }: Props) => <div/>;",
    ]);
    expect(declared.get("Card")?.props).toEqual({ title: { hasDefault: false }, elevated: { required: false, default: true } });
  });

  it("reads props through a forwardRef wrapper's first param", () => {
    const declared = extract("/repo/src/input.tsx", [
      "import { forwardRef } from 'react';",
      "const Input = forwardRef(({ value, big = false }, ref) => <input ref={ref}/>);",
      "export default Input;",
    ]);
    expect(declared.get("Input")?.props).toEqual({ value: { hasDefault: false }, big: { required: false, default: false } });
  });

  it("reads props through a memo wrapper's first param", () => {
    const declared = extract("/repo/src/badge.tsx", [
      "import { memo } from 'react';",
      "export const Badge = memo(function ({ tone }) { return <b/>; });",
    ]);
    expect(declared.get("Badge")?.props).toEqual({ tone: { hasDefault: false } });
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
    expect(declared.get("Panel")).toEqual({ props: { title: { hasDefault: false } }, hasRest: false });
  });

  it("extracts a lowercase helper", () => {
    const declared = extract("/repo/src/rows.tsx", [
      "function renderRow({ id, label = \"none\" }) { return <li key={id}>{label}</li>; }",
    ]);
    expect(declared.get("renderRow")).toEqual({
      props: { id: { hasDefault: false }, label: { required: false, default: "none" } },
      hasRest: false,
    });
  });

  it("extracts a function that returns null", () => {
    const declared = extract("/repo/src/empty.tsx", ["export function Empty({ when }) { return null; }"]);
    expect(declared.get("Empty")).toEqual({ props: { when: { hasDefault: false } }, hasRest: false });
  });

  it("reads props through a wrapper nested in another wrapper", () => {
    const declared = extract("/repo/src/field.tsx", [
      "import { memo, forwardRef } from 'react';",
      "export const Field = memo(forwardRef(({ name, size = \"m\" }, ref) => <input name={name} ref={ref}/>));",
    ]);
    expect(declared.get("Field")).toEqual({
      props: { name: { hasDefault: false }, size: { required: false, default: "m" } },
      hasRest: false,
    });
  });

  it("keys an anonymous default export as `default`", () => {
    expect(extract("/repo/src/a.tsx", ["export default ({ size = 2 }) => <div/>;"]).get("default")).toEqual({
      props: { size: { required: false, default: 2 } },
      hasRest: false,
    });
    expect(extract("/repo/src/b.tsx", ["export default function ({ open }) { return <div/>; }"]).get("default")).toEqual({
      props: { open: { hasDefault: false } },
      hasRest: false,
    });
    expect(
      extract("/repo/src/c.tsx", ["import { memo } from 'react';", "export default memo(({ items }) => <ul/>);"]).get("default"),
    ).toEqual({ props: { items: { hasDefault: false } }, hasRest: false });
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
      props: {
        label: { required: true, hasDefault: false },
        tone: { required: false, hasDefault: false },
        "aria-label": { required: false, hasDefault: false },
      },
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
      props: {
        title: { required: true, hasDefault: false },
        elevated: { required: false, default: true },
        footer: { required: false, hasDefault: false },
      },
      hasRest: false,
    });
  });

  it("takes a default from defaultProps when the parameter doesn't set one", () => {
    const declared = extract(
      "/repo/src/button.jsx",
      [
        PT,
        "export default function Button({ size, variant = 'primary', onClick }) { return <button/>; }",
        "Button.propTypes = { size: PropTypes.string, variant: PropTypes.string, tone: PropTypes.string, icon: PropTypes.node };",
        "Button.defaultProps = { size: 'md', variant: 'secondary', tone: null, icon: <i/>, extra: 1 };",
      ],
      18,
    );
    expect(declared.get("Button")).toEqual({
      props: {
        size: { required: false, default: "md" },
        // The destructured default wins.
        variant: { required: false, default: "primary" },
        // Not in a defaultProps read in full: no default.
        onClick: { hasDefault: false },
        tone: { required: false, default: null },
        // A non-literal default. `extra` names no prop.
        icon: { required: false, hasDefault: true },
      },
      hasRest: false,
    });
  });

  it("applies defaultProps to a destructured component without propTypes", () => {
    const declared = extract("/repo/src/tag.jsx", ["export const Tag = ({ tone }) => <b/>;", "Tag.defaultProps = { tone: 'info' };"], 18);
    expect(declared.get("Tag")).toEqual({ props: { tone: { required: false, default: "info" } }, hasRest: false });
  });

  it("keeps a destructured non-literal default over a defaultProps value", () => {
    const declared = extract("/repo/src/list.jsx", ["export const List = ({ items = [] }) => <ul/>;", "List.defaultProps = { items: null };"], 18);
    expect(declared.get("List")?.props).toEqual({ items: { required: false, hasDefault: true } });
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
    expect(staticFields.get("Dialog")).toEqual({
      props: { title: { required: true, hasDefault: false }, size: { required: false, default: "md" } },
      hasRest: false,
    });
  });

  it("reads propTypes through a const, a one-argument wrapper call, parentheses and a TS cast", () => {
    const declared = extract("/repo/src/field.tsx", [
      PT,
      "const propTypes = { label: (PropTypes.string.isRequired), hint: PropTypes.string as any };",
      "export const Field = (props: object) => <input/>;",
      "Field.propTypes = forbidExtraProps(propTypes);",
    ]);
    expect(declared.get("Field")).toEqual({
      props: { label: { required: true, hasDefault: false }, hint: { required: false, hasDefault: false } },
      hasRest: false,
    });
  });

  it("leaves required absent for a value it can't read as a prop-types validator", () => {
    const declared = extract("/repo/src/x.jsx", [
      PT,
      "export const X = (props) => <b/>;",
      "X.propTypes = { title: shared.title, check: (props, name) => null, named: PropTypes.string };",
    ]);
    expect(declared.get("X")?.props).toEqual({ title: { hasDefault: false }, check: { hasDefault: false }, named: { required: false, hasDefault: false } });
  });

  it("reads named prop-types imports as validators", () => {
    const declared = extract("/repo/src/x.jsx", ["import { string, oneOf } from 'prop-types';", "export const X = (props) => <b/>;", "X.propTypes = { a: string, b: oneOf(['x']) };"]);
    expect(declared.get("X")?.props).toEqual({ a: { required: false, hasDefault: false }, b: { required: false, hasDefault: false } });
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
    expect(declared.get("X")?.props.constructor).toEqual({ required: true, hasDefault: false });
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

describe("extractReactDeclaredProps: each prop's default state from defaultProps", () => {
  /** The scan-format default contract: no default value beside `hasDefault: false`, and `defaultRef` only with `hasDefault: true`. */
  function expectDefaultContract(props: Record<string, { default?: unknown; hasDefault?: boolean; defaultRef?: string }>): void {
    for (const prop of Object.values(props)) {
      if (prop.hasDefault === false) expect(prop.default).toBeUndefined();
      if (prop.defaultRef !== undefined) expect(prop.hasDefault).toBe(true);
    }
  }

  it("states a non-literal default as hasDefault, with the name it refers to", () => {
    const props = extract(
      "/repo/src/button.jsx",
      [PT, "export const Button = (props) => <button/>;", "Button.propTypes = { icon: PropTypes.node, theme: PropTypes.object };", "Button.defaultProps = { icon: <i/>, theme: themes.light };"],
      18,
    ).get("Button")?.props;
    expect(props).toEqual({ icon: { required: false, hasDefault: true }, theme: { required: false, hasDefault: true, defaultRef: "themes.light" } });
    expectDefaultContract(props ?? {});
  });

  it("states no default for a prop a defaultProps read in full doesn't name", () => {
    const props = extract(
      "/repo/src/card.jsx",
      [PT, "export const Card = (props) => <div/>;", "Card.propTypes = { title: PropTypes.string.isRequired, footer: PropTypes.node, size: PropTypes.string };", "Card.defaultProps = { size: 'md' };"],
      18,
    ).get("Card")?.props;
    expect(props).toEqual({
      title: { required: true, hasDefault: false },
      footer: { required: false, hasDefault: false },
      size: { required: false, default: "md" },
    });
  });

  it("states no default when there's no defaultProps at all", () => {
    const props = extract("/repo/src/modal.jsx", [PT, "export class Modal extends React.Component { render() { return null; } }", "Modal.propTypes = { open: PropTypes.bool };"], 19).get("Modal")?.props;
    expect(props).toEqual({ open: { required: false, hasDefault: false } });
  });

  it.each([
    ["an imported object", "Tag.defaultProps = sharedDefaults;"],
    ["a call it can't see into", "Tag.defaultProps = makeDefaults(theme, 'md');"],
  ])("leaves the default unread for %s", (_, assignment) => {
    const props = extract("/repo/src/tag.jsx", [PT, "export const Tag = ({ tone, label = 'Tag' }) => <b/>;", "Tag.propTypes = { size: PropTypes.string };", assignment], 18).get("Tag")?.props;
    // The destructured default still holds; the others could be in the object the scan can't read.
    expect(props).toEqual({ tone: {}, label: { required: false, default: "Tag" }, size: { required: false } });
  });

  it("reads past a spread only what comes after it", () => {
    const props = extract(
      "/repo/src/tag.jsx",
      [
        PT,
        "export const Tag = (props) => <b/>;",
        "Tag.propTypes = { tone: PropTypes.string, size: PropTypes.string, label: PropTypes.string, icon: PropTypes.node };",
        "Tag.defaultProps = { tone: 'info', icon: null, ...Base.defaultProps, size: 'md' };",
      ],
      18,
    ).get("Tag")?.props;
    expect(props).toEqual({
      // Set before the spread: a default, but the spread may replace its value.
      tone: { required: false, hasDefault: true },
      // Set before the spread to null: still a default after it.
      icon: { required: false, hasDefault: true },
      // After the spread: the value stands.
      size: { required: false, default: "md" },
      // Not named, but the spread may set it.
      label: { required: false },
    });
    expectDefaultContract(props ?? {});
  });

  it("treats a computed key like a spread", () => {
    const props = extract("/repo/src/tag.jsx", ["export const Tag = ({ tone, size }) => <b/>;", "Tag.defaultProps = { [key]: 'x', size: 'md' };"], 18).get("Tag")?.props;
    expect(props).toEqual({ tone: {}, size: { required: false, default: "md" } });
  });

  it("states no default for an entry set to undefined", () => {
    const props = extract("/repo/src/tag.jsx", ["export const Tag = ({ tone }) => <b/>;", "Tag.defaultProps = { tone: undefined };"], 18).get("Tag")?.props;
    expect(props).toEqual({ tone: { hasDefault: false } });
  });

  describe("React 19 ignores a function component's defaultProps", () => {
    const lines = [
      PT,
      "export const Button = ({ size, variant = 'primary' }) => <button/>;",
      "Button.propTypes = { size: PropTypes.string, tone: PropTypes.string.isRequired, icon: PropTypes.node };",
      "Button.defaultProps = { size: 'md', tone: 'info' };",
    ];

    it("states no default for a function component on React 19 or later, keeping a destructured one", () => {
      for (const major of [19, 20]) {
        expect(extract("/repo/src/button.jsx", lines, major).get("Button")?.props).toEqual({
          size: { required: false, hasDefault: false },
          variant: { required: false, default: "primary" },
          // `.isRequired` stands: the default that would have made it optional never applies.
          tone: { required: true, hasDefault: false },
          icon: { required: false, hasDefault: false },
        });
      }
    });

    it("reads the defaults on React 18 and earlier", () => {
      expect(extract("/repo/src/button.jsx", lines, 18).get("Button")?.props).toEqual({
        size: { required: false, default: "md" },
        variant: { required: false, default: "primary" },
        tone: { required: false, default: "info" },
        icon: { required: false, hasDefault: false },
      });
    });

    it("leaves the props defaultProps names unread when the React version isn't known", () => {
      expect(extract("/repo/src/button.jsx", lines, null).get("Button")?.props).toEqual({
        size: { required: false },
        variant: { required: false, default: "primary" },
        tone: { required: false },
        // Not named by defaultProps: no default, whichever React it is.
        icon: { required: false, hasDefault: false },
      });
    });

    it("keeps a class component's defaults on React 19", () => {
      const props = extract(
        "/repo/src/dialog.jsx",
        [PT, "export class Dialog extends React.Component {", "  static propTypes = { size: PropTypes.string, title: PropTypes.string };", "  static defaultProps = { size: 'md' };", "  render() { return null; }", "}"],
        19,
      ).get("Dialog")?.props;
      expect(props).toEqual({ size: { required: false, default: "md" }, title: { required: false, hasDefault: false } });
    });

    it("treats a memo or forwardRef wrapper as a function component", () => {
      const props = extract("/repo/src/chip.jsx", ["export const Chip = React.memo(({ tone }) => <b/>);", "Chip.defaultProps = { tone: 'info' };"], 19).get("Chip")?.props;
      expect(props).toEqual({ tone: { hasDefault: false } });
    });
  });
});
