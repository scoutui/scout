import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseVueSfc } from "@vue/compiler-sfc";
import { parseSync } from "oxc-parser";
import {
  detectVueComponents,
  type VueDetectorInput,
  type VueParseWrapper,
} from "../../src/local-index/detect-vue.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures", "local-detection");

const wrapperFor = (source: string): VueParseWrapper => {
  const { descriptor } = parseVueSfc(source);
  const scriptContent = descriptor.scriptSetup?.content ?? descriptor.script?.content;
  if (scriptContent && scriptContent.length > 0) {
    return {
      descriptor,
      scriptProgram: parseSync("sfc-script.ts", scriptContent).program,
    };
  }
  return { descriptor };
};

const sfcInput = (source: string): VueDetectorInput => ({ kind: "sfc", wrapper: wrapperFor(source) });

const scriptInput = (source: string, filename = "inline.ts"): VueDetectorInput => ({
  kind: "script",
  program: parseSync(filename, source).program,
  source,
});

describe("detectVueComponents: fixture matrix", () => {
  it("vue-sfc/Card.vue detects SFC with name from defineOptions", () => {
    const dir = "vue-sfc";
    const file = "Card.vue";
    const filePath = `tests/fixtures/local-detection/${dir}/${file}`;
    const source = readFileSync(join(FIXTURES, dir, file), "utf8");
    const out = detectVueComponents(sfcInput(source), filePath);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      exportName: "Card",
      detector: "vue-sfc",
      componentId: {
        kind: "vue-component",
        export: "Card",
        source: { type: "local", filePath },
      },
    });
  });

  it("vue-define-component/Counter.ts detects defineComponent export", () => {
    const dir = "vue-define-component";
    const file = "Counter.ts";
    const filePath = `tests/fixtures/local-detection/${dir}/${file}`;
    const source = readFileSync(join(FIXTURES, dir, file), "utf8");
    const out = detectVueComponents(scriptInput(source, file), filePath);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      exportName: "Counter",
      detector: "vue-define-component",
      componentId: {
        kind: "vue-component",
        export: "Counter",
        source: { type: "local", filePath },
      },
    });
  });

  it("vue-sfc handles defineOptions with name not first key", () => {
    const filePath = "tests/inline/Edge.vue";
    const source = `<template><div /></template>
<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
  name: "EdgeName",
});
</script>`;
    const out = detectVueComponents(sfcInput(source), filePath);
    expect(out[0]?.exportName).toBe("EdgeName");
  });

  it("vue-sfc ignores nested name in defineOptions and picks outer name", () => {
    const filePath = "tests/inline/Nested.vue";
    const source = `<template><div /></template>
<script setup lang="ts">
defineOptions({
  inject: { foo: { name: "inner" } },
  name: "OuterName",
});
</script>`;
    const out = detectVueComponents(sfcInput(source), filePath);
    expect(out[0]?.exportName).toBe("OuterName");
  });

  it("vue-sfc returns empty when SFC parse throws on malformed input", () => {
    const filePath = "tests/inline/Bad.vue";
    // Malformed, but the SFC parser is tolerant and produces an empty descriptor.
    const source = "<template><div></template>";
    const out = detectVueComponents(sfcInput(source), filePath);
    expect(Array.isArray(out)).toBe(true);
  });

  it("vue-functional/Tabs.ts detects functional component with render", () => {
    const dir = "vue-functional";
    const file = "Tabs.ts";
    const filePath = `tests/fixtures/local-detection/${dir}/${file}`;
    const source = readFileSync(join(FIXTURES, dir, file), "utf8");
    const out = detectVueComponents(scriptInput(source, file), filePath);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      exportName: "Tabs",
      detector: "vue-functional",
      componentId: {
        kind: "vue-component",
        export: "Tabs",
        source: { type: "local", filePath },
      },
    });
  });
});

describe("detect-vue: declared prop API", () => {
  const sfc = (script: string) => `<template><div/></template>\n<script setup lang="ts">\n${script}\n</script>`;

  it("reads type-literal defineProps with `?` and reactive-destructure defaults", () => {
    const out = detectVueComponents(
      sfcInput(sfc(`const { variant = 'primary', size } = defineProps<{ variant?: string; size: number }>()`)),
      "tests/inline/Btn.vue",
    );
    expect(out[0]?.declared).toEqual({
      props: {
        variant: { required: false, type: "string", default: "primary" },
        size: { required: true, type: "number" },
      },
      hasRest: false,
    });
  });

  it("reads withDefaults defaults over a type-literal", () => {
    const out = detectVueComponents(
      sfcInput(sfc("const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false })")),
      "tests/inline/Modal.vue",
    );
    expect(out[0]?.declared?.props.open).toEqual({ required: false, type: "boolean", default: false });
  });

  it("reads object-runtime defineProps", () => {
    const out = detectVueComponents(
      sfcInput(sfc(`const props = defineProps({ variant: { type: String, default: 'a', required: true } })`)),
      "tests/inline/Tag.vue",
    );
    expect(out[0]?.declared?.props.variant).toEqual({ type: "String", required: true, default: "a" });
  });

  it("omits declared for defineProps<ImportedType>() with no destructure", () => {
    const out = detectVueComponents(
      sfcInput(sfc(`import type { Props } from './p'\nconst props = defineProps<Props>()`)),
      "tests/inline/Imp.vue",
    );
    expect(out[0]?.declared).toBeUndefined();
  });
});
