import type { AttributeNode, DirectiveNode, ElementNode } from "@vue/compiler-core";
import { isHandlerName, type PropUsage } from "@scoutui/reference-graph";
import { classifyExprText } from "./classify-expr-text.js";
import { VueNode } from "./parse-sfc.js";

const QUOTED_STRING_RE = /^(['"])(.*)\1$/s;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const BOOLEAN_RE = /^(true|false)$/;

/** An attribute as written: its name with any directive shorthand, and its value. */
function attrOf(prop: AttributeNode | DirectiveNode): { name: string; value: string } {
  if (prop.type === VueNode.ATTRIBUTE) return { name: prop.name, value: prop.value?.content ?? "" };
  return {
    name: prop.rawName ?? `v-${prop.name}`,
    value: prop.exp?.type === VueNode.SIMPLE_EXPRESSION ? prop.exp.content : "",
  };
}

/** Vue's `camelize`, the name a component receives a hyphenated prop under: `is-preview` → `isPreview`. */
export const camelize = (name: string): string => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** `v-model`, `v-model:title` and either with modifiers (`v-model.trim`); a dynamic argument (`v-model:[name]`) doesn't match. */
const V_MODEL_RE = /^v-model(?::([^.[\]]+))?(?:\..*)?$/;

/**
 * The props and events an element writes. On a component, `v-model` binds the
 * `modelValue` prop and `v-model:title` binds `title`, as Vue compiles them; a
 * custom element's `v-model` depends on the app's compiler options, so it's
 * skipped there.
 */
export function readAttrs(el: ElementNode, target: "component" | "custom-element"): { props: PropUsage[]; events: string[] } {
  const props: PropUsage[] = [];
  const events: string[] = [];
  for (const attr of el.props.map(attrOf)) {
    if (/^@|^v-on:/.test(attr.name)) {
      events.push(attr.name.replace(/^@|^v-on:/, ""));
      continue;
    }
    if (attr.name === "v-bind") {
      if (!props.some((p) => p.name === "...rest")) props.push({ name: "...rest", tier: "dynamic" });
      continue;
    }
    const model = V_MODEL_RE.exec(attr.name);
    if (model && target === "component") {
      props.push(classifyBindExpr(model[1] ?? "modelValue", attr.value.trim()));
      continue;
    }
    if (/^v-/.test(attr.name) && !/^v-bind:/.test(attr.name)) continue;
    if (/^[:.]|^v-bind:/.test(attr.name)) {
      const name = attr.name.replace(/^[:.]|^v-bind:/, "");
      const usage = classifyBindExpr(name, attr.value.trim());
      props.push(isHandlerName(camelize(name)) && usage.tier !== "written" ? { name, tier: "dynamic" } : usage);
      continue;
    }
    props.push({ name: attr.name, tier: "written", value: attr.value === "" ? true : attr.value });
  }
  return { props, events };
}

function classifyBindExpr(name: string, expr: string): PropUsage {
  const quoted = expr.match(QUOTED_STRING_RE);
  if (quoted) return { name, tier: "written", value: quoted[2] ?? "" };
  if (NUMERIC_RE.test(expr)) return { name, tier: "written", value: Number(expr) };
  if (BOOLEAN_RE.test(expr)) return { name, tier: "written", value: expr === "true" };
  const c = classifyExprText(expr);
  return c.tier === "reference" ? { name, tier: "reference", ref: c.ref } : { name, tier: "dynamic" };
}
