import { describe, expect, it } from "vitest";
import { posix } from "node:path";
import { parse as parseVueSfc } from "@vue/compiler-sfc";
import { parseSync } from "oxc-parser";
import { createGraphBuilder, resolve } from "@scoutui/reference-graph";
import { emitReact } from "@scoutui/parser-react";
import { emitVueTemplate } from "@scoutui/parser-vue";

const REPO = "/repo";

/** Parse → emit → resolve over React and Vue files together, each through its
 *  own emitter, as the scan does. A relative specifier resolves to the file
 *  it names, with or without an extension. */
function scanMixed(files: Record<string, string>) {
  const gb = createGraphBuilder({
    moduleResolver: (from, spec) => {
      if (!spec.startsWith(".")) return null;
      const base = posix.resolve(REPO, posix.dirname(from), spec);
      const hit = ["", ".tsx", ".ts", ".vue"].map((ext) => base + ext).find((p) => posix.relative(REPO, p) in files);
      return hit ?? null;
    },
    repoRoot: REPO,
  });
  for (const [file, source] of Object.entries(files)) {
    if (file.endsWith(".vue")) {
      const { descriptor } = parseVueSfc(source);
      const script = descriptor.scriptSetup?.content ?? descriptor.script?.content;
      const wrapper = script ? { descriptor, scriptProgram: parseSync("script.ts", script).program } : { descriptor };
      emitVueTemplate({ file, wrapper, fileBuilder: gb.beginFile(file, "vue") });
    } else {
      emitReact({ file, source, ast: parseSync(file, source).program, fileBuilder: gb.beginFile(file) });
    }
  }
  return resolve(gb.build());
}

describe("registry membership from a Vue template", () => {
  it("a function a Vue template renders as a tag is not a React registry member", () => {
    const { occurrences, registry } = scanMixed({
      "src/Foo.ts": "export const Foo = () => null;\nexport const Bar = () => null;",
      "src/Page.vue": `<script setup>\nimport { Foo, Bar } from "./Foo";\n</script>\n<template><div><Foo /><Bar /></div></template>`,
    });
    expect(occurrences.map((o) => o.rawComponentId?.kind)).toEqual(["vue-component", "vue-component"]);
    expect(registry.localEntries()).toEqual([]);
  });
});

describe("a Vue declaration reached from a React tag", () => {
  it("a Vue SFC a React file renders as a tag is credited and is not a React registry member", () => {
    const { occurrences, registry } = scanMixed({
      "src/Foo.vue": "<template><div>foo</div></template>\n<script setup>\nconst x = 1;\n</script>",
      "src/App.tsx": `import Foo from "./Foo.vue";\nexport function App() { return <Foo />; }`,
    });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "react-component", export: "Foo", source: { type: "local", filePath: "src/Foo.vue" } },
    ]);
    expect(registry.localEntries().map((e) => e.filePath)).toEqual(["src/App.tsx"]);
  });
});

describe("a React declaration reached across the Vue boundary is judged by its declaring file", () => {
  it("a Vue template rendering a React memo of a context credits nothing", () => {
    const { occurrences } = scanMixed({
      "src/held.tsx": `import { createContext, memo } from "react";\nconst Slot = createContext(null);\nexport const Held = memo(Slot);`,
      "src/Page.vue": `<template><Held /></template>\n<script setup>\nimport { Held } from "./held";\n</script>`,
    });
    expect(occurrences).toEqual([]);
  });

  it("a Vue SFC a React file hands to a hook is credited at the argument", () => {
    const { occurrences } = scanMixed({
      "src/Foo.vue": "<template><div>foo</div></template>\n<script setup>\nconst x = 1;\n</script>",
      "src/App.tsx": `import { useModal } from "kit";\nimport Foo from "./Foo.vue";\nexport function App() { useModal(Foo); return <div />; }`,
    });
    expect(occurrences.map((o) => [o.rawComponentId, o.via.kind])).toEqual([
      [{ kind: "react-component", export: "Foo", source: { type: "local", filePath: "src/Foo.vue" } }, "passed-as-argument"],
    ]);
  });
});
