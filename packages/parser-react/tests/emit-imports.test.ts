import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import { createGraphBuilder, MODULE_SCOPE } from "@scoutui/reference-graph";
import { emitReact } from "../src/emit.js";

function parseTsx(source: string) {
  return parseSync("test.tsx", source).program;
}

describe("emitReact: import emission", () => {
  it("emits a named ImportRecord for `import { Foo } from 'pkg'`", () => {
    const source = `import { Foo } from "pkg";`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    emitReact({ file: "src/App.tsx", source, ast: parseTsx(source), fileBuilder: fb });
    const graph = gb.build();
    const imports = graph.files.get("src/App.tsx")?.imports ?? [];
    expect(imports).toContainEqual(
      expect.objectContaining({
        specifier: "pkg",
        imported: "Foo",
        local: "Foo",
        scope: MODULE_SCOPE,
      }),
    );
  });

  it("emits with rename: `import { Foo as Bar } from 'pkg'`", () => {
    const source = `import { Foo as Bar } from "pkg";`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    emitReact({ file: "src/App.tsx", source, ast: parseTsx(source), fileBuilder: fb });
    const graph = gb.build();
    const imports = graph.files.get("src/App.tsx")?.imports ?? [];
    expect(imports[0]?.imported).toBe("Foo");
    expect(imports[0]?.local).toBe("Bar");
  });

  it("emits default: `import Foo from 'pkg'`", () => {
    const source = `import Foo from "pkg";`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    emitReact({ file: "src/App.tsx", source, ast: parseTsx(source), fileBuilder: fb });
    const graph = gb.build();
    const imports = graph.files.get("src/App.tsx")?.imports ?? [];
    expect(imports[0]?.imported).toBe("default");
    expect(imports[0]?.local).toBe("Foo");
  });

  it("emits namespace: `import * as NS from 'pkg'`", () => {
    const source = `import * as NS from "pkg";`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    emitReact({ file: "src/App.tsx", source, ast: parseTsx(source), fileBuilder: fb });
    const graph = gb.build();
    const imports = graph.files.get("src/App.tsx")?.imports ?? [];
    expect(imports[0]?.imported).toBe("*");
    expect(imports[0]?.local).toBe("NS");
  });
});

describe("side-effect imports", () => {
  it("records no import for a bindingless import", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/register.ts");
    const source = `import "@x/wrapper/components/button.js";\n`;
    emitReact({ file: "src/register.ts", source, ast: parseTsx(source), fileBuilder: fb });
    expect(gb.build().files.get("src/register.ts")?.imports).toEqual([]);
  });
});
