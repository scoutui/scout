import { describe, it, expect } from "vitest";
import { parseByExt, syntaxErrorWarning } from "../../src/parse-by-ext.js";
import type { Statement } from "@oxc-project/types";

describe("parseByExt", () => {
  it("parses .tsx as oxc Program", () => {
    const r = parseByExt("src/A.tsx", "export const A = () => <div/>;");
    expect(r.kind).toBe("babel");
    if (r.kind !== "babel") throw new Error("type narrow");
    expect(r.ast.type).toBe("Program");
    expect(r.ast.body.length).toBeGreaterThan(0);
  });

  it("parses .ts without jsx so <const> casts succeed", () => {
    const src = "export const f = () => { return <const>{ a: 1 }; };";
    const r = parseByExt("src/routes.ts", src);
    expect(r.kind).toBe("babel");
    if (r.kind !== "babel") throw new Error("type narrow");
    expect(r.ast.body.length).toBeGreaterThan(0);
  });

  it("parses .vue as { kind: 'vue', descriptor, scriptAst? }", () => {
    const src = '<template><div/></template><script lang="ts">export const x = 1;</script>';
    const r = parseByExt("src/X.vue", src);
    expect(r.kind).toBe("vue");
    if (r.kind !== "vue") throw new Error("type narrow");
    expect(r.descriptor.template?.content.trim()).toBe("<div/>");
    expect(r.scriptAst?.type).toBe("Program");
  });

  it("parses .vue with no script block (scriptAst undefined)", () => {
    const src = "<template><div/></template>";
    const r = parseByExt("src/X.vue", src);
    if (r.kind !== "vue") throw new Error("type narrow");
    expect(r.scriptAst).toBeUndefined();
  });

  it("returns { kind: 'unsupported' } for unknown extensions", () => {
    const r = parseByExt("src/x.md", "# hi");
    expect(r.kind).toBe("unsupported");
  });

  it("reports recovered syntax errors as one warning line and carries on", () => {
    // oxc-parser emits errors[] but returns a partial program rather than
    // throwing, so partially-broken files don't tank the scan.
    const reported: string[] = [];
    const parsed = parseByExt("src/A.ts", "const x;\nexport const y = 1;", (path, messages) => reported.push(syntaxErrorWarning(path, messages)));
    expect(parsed.kind).toBe("babel");
    expect(reported).toEqual(["src/A.ts has syntax errors (Missing initializer in const declaration), so the scan read what it could."]);
  });

  it("reports a Vue file's script syntax errors under the .vue file's path", () => {
    const reported: string[] = [];
    parseByExt("src/X.vue", "<script setup lang=\"ts\">const x = 1 const y = 2</script>", (path) => reported.push(path));
    expect(reported).toEqual(["src/X.vue"]);
  });

  it("parses JSX inside .js files (lang hint propagated)", () => {
    const parsed = parseByExt("/tmp/x.js", "export const X = () => <div />;");
    expect(parsed.kind).toBe("babel");
    if (parsed.kind === "babel") {
      expect(parsed.ast.type).toBe("Program");
      expect(parsed.ast.body.length).toBeGreaterThan(0);
      const exportNode = parsed.ast.body.find((n: Statement) => n.type === "ExportNamedDeclaration");
      expect(exportNode).toBeDefined();
    }
  });
});
