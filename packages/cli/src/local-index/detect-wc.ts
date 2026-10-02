import { walk } from "oxc-walker";
import type { Program, Node } from "@oxc-project/types";
import { positionAt } from "@scoutui/parser-react";
import { canonicalTagName, isValidCustomElementName } from "@scoutui/reference-graph";
import type { LocalDefinition } from "./types.js";

/**
 * Detect local custom-element registrations. Looks for two patterns:
 *  1. @customElement("tag-name") class Foo extends HTMLElement {}
 *  2. customElements.define("tag-name", MyButton), also read through
 *     `window`, `globalThis` or `self`
 *
 * Each definition is keyed by the canonical tag name and located at the
 * decorator or the `define` call. Its `exportName` is the registered class's
 * identifier, or the tag itself when the class has none (see
 * `registeredClassName`).
 */
export function detectWebComponents(
  program: Program,
  source: string,
  filePath: string,
): LocalDefinition[] {
  const out: LocalDefinition[] = [];
  const registration = (
    tagName: string,
    className: string | null,
    start: number,
    detector: LocalDefinition["detector"],
  ): LocalDefinition => ({
    componentId: { kind: "custom-element", tagName, source: { type: "local", filePath } },
    exportName: className ?? tagName,
    isDefault: false,
    detector,
    loc: { file: filePath, ...positionAt(source, start) },
  });

  walk(program, {
    enter(node: Node) {
      // Pattern 1: @customElement("…") class Foo …
      if (node.type === "ClassDeclaration") {
        for (const decorator of node.decorators) {
          const tag = extractCustomElementTag(decorator.expression);
          if (tag) out.push(registration(tag, node.id?.name ?? null, decorator.start, "wc-decorator"));
        }
      }

      // Pattern 2: customElements.define("…", MyButton)
      if (node.type === "CallExpression") {
        if (!isCustomElementsDefine(node)) return;
        const [tagArg, classArg] = node.arguments;
        if (!tagArg || tagArg.type !== "Literal" || typeof tagArg.value !== "string") return;
        const tag = canonicalTagName(tagArg.value);
        if (!isValidCustomElementName(tag)) return;
        const className = classArg?.type === "Identifier" ? classArg.name : null;
        out.push(registration(tag, className, node.start, "wc-customelements-define"));
      }
    },
  });

  return out;
}

/** The class a custom-element registration names, or null when the registration names no class identifier. */
export function registeredClassName(def: LocalDefinition): string | null {
  // An identifier cannot contain `-`, which every custom element name does.
  return def.componentId.kind === "custom-element" && def.exportName === def.componentId.tagName ? null : def.exportName;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Return the canonical tag from a @customElement("tag-name") decorator expression, or null. */
function extractCustomElementTag(expr: Node): string | null {
  if (expr.type !== "CallExpression") return null;
  const callee = expr.callee;
  if (callee.type !== "Identifier" || callee.name !== "customElement") return null;
  const arg = expr.arguments[0];
  if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") return null;
  const tag = canonicalTagName(arg.value);
  return isValidCustomElementName(tag) ? tag : null;
}

/** The global objects `customElements` is read from as a property. */
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

/**
 * Return true when the node is a `customElements.define(…)` call, the
 * registry read bare or as a property of a global object
 * (`window.customElements.define(…)`).
 */
function isCustomElementsDefine(node: Node & { type: "CallExpression" }): boolean {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier" || callee.property.name !== "define") {
    return false;
  }
  const registry = callee.object;
  if (registry.type === "Identifier") return registry.name === "customElements";
  return (
    registry.type === "MemberExpression" &&
    !registry.computed &&
    registry.property.type === "Identifier" &&
    registry.property.name === "customElements" &&
    registry.object.type === "Identifier" &&
    GLOBAL_OBJECTS.has(registry.object.name)
  );
}
