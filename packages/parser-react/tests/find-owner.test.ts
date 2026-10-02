import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import type { Node, Program } from "@oxc-project/types";
import {
  findEnclosingComponentBinding,
  type EnclosingComponentBinding,
} from "../src/find-owner.js";

/** Locate the first JSXElement under `program` via plain object walk. */
function firstJSXElement(program: Program): Node | null {
  let found: Node | null = null;
  const visit = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    const node = n as { type?: string };
    if (node.type === "JSXElement") {
      found = node as Node;
      return;
    }
    for (const k of Object.keys(node)) {
      // Skip the back-pointer field that oxc-walker may add at walk time.
      if (k === "parent") continue;
      const v = (node as Record<string, unknown>)[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(program);
  return found;
}

function firstJsxOwner(
  source: string,
  isKnownComponent?: (name: string) => boolean,
): EnclosingComponentBinding | null {
  const result = parseSync("test.tsx", source);
  const jsx = firstJSXElement(result.program);
  if (!jsx) throw new Error(`no JSXElement in source: ${source}`);
  return findEnclosingComponentBinding(jsx, result.program, isKnownComponent);
}

describe("findEnclosingComponentBinding", () => {
  it("named function declaration → owner is the function name", () => {
    const out = firstJsxOwner("function Page() { return <Foo/>; }");
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(false);
  });

  it("arrow assigned to PascalCase const → owner is the binding name", () => {
    const out = firstJsxOwner("const Page = () => <Foo/>;");
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(false);
  });

  it("function expression assigned to PascalCase const → owner is the binding name", () => {
    const out = firstJsxOwner("const Page = function () { return <Foo/>; };");
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(false);
  });

  it("memo-wrapped → owner is the outer binding name", () => {
    const out = firstJsxOwner(
      `import { memo } from 'react'; const Page = memo(() => <Foo/>);`,
    );
    expect(out?.name).toBe("Page");
  });

  it("forwardRef-wrapped → owner is the outer binding name", () => {
    const out = firstJsxOwner(
      `import { forwardRef } from 'react'; const Page = forwardRef(() => <Foo/>);`,
    );
    expect(out?.name).toBe("Page");
  });

  it("observer-wrapped → owner is the outer binding name", () => {
    const out = firstJsxOwner(
      `import { observer } from 'mobx-react'; const Page = observer(() => <Foo/>);`,
    );
    expect(out?.name).toBe("Page");
  });

  it("React.memo member call → owner is the outer binding name", () => {
    const out = firstJsxOwner("const Page = React.memo(() => <Foo/>);");
    expect(out?.name).toBe("Page");
  });

  it("React.forwardRef member call → owner is the outer binding name", () => {
    const out = firstJsxOwner("const Page = React.forwardRef(() => <Foo/>);");
    expect(out?.name).toBe("Page");
  });

  it("class component → owner is class name", () => {
    const out = firstJsxOwner(
      "class Page extends Component { render() { return <Foo/>; } }",
    );
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(false);
  });

  it("non-PascalCase function wraps JSX in callback → walks up to Page", () => {
    const out = firstJsxOwner(
      "function Page() { return items.map(i => <Foo key={i}/>); }",
    );
    expect(out?.name).toBe("Page");
  });

  it("anonymous default export arrow → isDefault true, name 'default'", () => {
    const out = firstJsxOwner("export default () => <Foo/>;");
    expect(out?.name).toBe("default");
    expect(out?.isDefault).toBe(true);
  });

  it("named default export function → isDefault true, name from id", () => {
    const out = firstJsxOwner("export default function Page() { return <Foo/>; }");
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(true);
  });

  it("anonymous default export function → isDefault true, name 'default'", () => {
    const out = firstJsxOwner("export default function () { return <Foo/>; }");
    expect(out?.name).toBe("default");
    expect(out?.isDefault).toBe(true);
  });

  it("memo-wrapped default export → isDefault true, name 'default'", () => {
    const out = firstJsxOwner(
      `import { memo } from 'react'; export default memo(() => <Foo/>);`,
    );
    expect(out?.name).toBe("default");
    expect(out?.isDefault).toBe(true);
  });

  it("default export of a class declaration with id → isDefault false, name from id", () => {
    // The class-id PascalCase check fires before the ExportDefault check, so
    // default-exported named classes report isDefault=false.
    const out = firstJsxOwner(
      "export default class Page { render() { return <Foo/>; } }",
    );
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(false);
  });

  it("named export of function → owner is function name, not default", () => {
    const out = firstJsxOwner("export function Page() { return <Foo/>; }");
    expect(out?.name).toBe("Page");
    expect(out?.isDefault).toBe(false);
  });

  it("returns null when JSX is at module scope (non-PascalCase const)", () => {
    const out = firstJsxOwner("const x = <Foo/>;");
    expect(out).toBeNull();
  });

  it("with predicate: skips non-matching candidates and returns the first known component", () => {
    const source = [
      "function Page() {",
      "  class HelperState {",
      "    render() { return <Bar/>; }",
      "  }",
      "  return null;",
      "}",
    ].join("\n");
    const out = firstJsxOwner(source, (name) => name === "Page");
    expect(out?.name).toBe("Page");
  });

  it("with predicate: returns null when no ancestor is known", () => {
    const out = firstJsxOwner("function helper() { return <Bar/>; }", () => false);
    expect(out).toBeNull();
  });

  it("returns the innermost owner when functions are nested", () => {
    // Outer/Inner both PascalCase → innermost (Inner) wins for JSX inside it.
    const out = firstJsxOwner(
      "function Outer() { function Inner() { return <span/>; } return <Inner/>; }",
    );
    expect(out?.name).toBe("Inner");
  });
});
