import type { SFCDescriptor } from "@vue/compiler-sfc";
import { parseSync } from "oxc-parser";
import type {
  Program,
  Node,
  ObjectExpression,
  ObjectProperty,
  ObjectPattern,
  TSType,
  Expression,
} from "@oxc-project/types";
import { basename, extname } from "node:path";
import type { LocalDefinition } from "./types.js";
import type { DeclaredPropApi } from "@scoutui/scan-format";
import {
  objectPatternToDeclared,
  typeLiteralToDeclared,
  objectRuntimeToDeclared,
  readLiteralValue,
} from "./declared-props.js";

// Mirrors @scoutui/parser-vue's VueParseWrapper, which its package root
// doesn't export. parseByExt produces both, so they keep the same shape.
export type VueParseWrapper = {
  descriptor: SFCDescriptor;
  scriptProgram?: Program;
};

export type VueDetectorInput =
  | { kind: "sfc"; wrapper: VueParseWrapper }
  | { kind: "script"; program: Program; source: string };

export function detectVueComponents(input: VueDetectorInput, filePath: string): LocalDefinition[] {
  if (input.kind === "sfc") {
    const def = detectSfc(input.wrapper, filePath);
    return def ? [def] : [];
  }
  return detectScriptDefineComponent(input.program, input.source, filePath);
}

function detectSfc(wrapper: VueParseWrapper, filePath: string): LocalDefinition | null {
  const exportName = resolveSfcName(wrapper, filePath);
  const def: LocalDefinition = {
    componentId: {
      kind: "vue-component",
      export: exportName,
      source: { type: "local", filePath },
    },
    exportName,
    isDefault: true,
    detector: "vue-sfc",
  };
  if (wrapper.scriptProgram) {
    const scriptSource = wrapper.descriptor.scriptSetup?.content ?? wrapper.descriptor.script?.content ?? "";
    const site = findDefinePropsSite(wrapper.scriptProgram);
    const declared = site ? siteToDeclared(site, scriptSource) : undefined;
    if (declared) def.declared = declared;
  }
  return def;
}

function resolveSfcName(wrapper: VueParseWrapper, filePath: string): string {
  const { descriptor, scriptProgram } = wrapper;
  // parseByExt prefers scriptSetup.content for scriptProgram; reuse it for the
  // defineOptions probe (scriptSetup-only API). If scriptSetup is absent,
  // scriptProgram came from `script` and is reusable for the options-object probe.
  const hasScriptSetup = descriptor.scriptSetup != null;
  const setupSrc = descriptor.scriptSetup?.content ?? "";
  const scriptSrc = descriptor.script?.content ?? "";

  const fromDefineOptions = hasScriptSetup
    ? extractDefineOptionsFromProgramOrSrc(scriptProgram, setupSrc)
    : null;
  if (fromDefineOptions) return fromDefineOptions;

  // Options-object form only lives in the plain `script` block. If scriptProgram
  // came from scriptSetup, we still need to parse `script.content` separately.
  const optionsProgram = hasScriptSetup ? undefined : scriptProgram;
  const fromOptionsObject = extractOptionsObjectFromProgramOrSrc(optionsProgram, scriptSrc);
  if (fromOptionsObject) return fromOptionsObject;

  return pascalFromFilename(filePath);
}

function extractDefineOptionsFromProgramOrSrc(program: Program | undefined, src: string): string | null {
  if (program) return extractDefineOptionsFromProgram(program);
  if (!src.includes("defineOptions")) return null;
  const parsed = tryParseOxc(src);
  return parsed ? extractDefineOptionsFromProgram(parsed) : null;
}

function extractDefineOptionsFromProgram(program: Program): string | null {
  for (const stmt of program.body) {
    const expr =
      stmt.type === "ExpressionStatement" ? stmt.expression : null;
    if (!expr) continue;
    const call = unwrapParens(expr as Node);
    if (
      call.type !== "CallExpression" ||
      call.callee.type !== "Identifier" ||
      call.callee.name !== "defineOptions"
    ) continue;
    const arg = call.arguments[0];
    if (!arg || arg.type !== "ObjectExpression") continue;
    const name = readNameProperty(arg as ObjectExpression);
    if (name) return name;
  }
  return null;
}

function extractOptionsObjectFromProgramOrSrc(program: Program | undefined, src: string): string | null {
  if (program) return extractOptionsObjectFromProgram(program);
  if (!src) return null;
  const parsed = tryParseOxc(src);
  return parsed ? extractOptionsObjectFromProgram(parsed) : null;
}

function extractOptionsObjectFromProgram(program: Program): string | null {
  for (const stmt of program.body) {
    if (stmt.type !== "ExportDefaultDeclaration") continue;
    const decl = unwrapParens(stmt.declaration as Node);
    if (decl.type === "ObjectExpression") {
      return readNameProperty(decl as ObjectExpression);
    }
    if (
      decl.type === "CallExpression" &&
      decl.callee.type === "Identifier" &&
      decl.callee.name === "defineComponent"
    ) {
      const arg = decl.arguments[0];
      if (arg && arg.type === "ObjectExpression") {
        return readNameProperty(arg as ObjectExpression);
      }
    }
  }
  return null;
}

function readNameProperty(obj: ObjectExpression): string | null {
  for (const p of obj.properties) {
    // In oxc, ObjectProperty has type: "Property" (interface name: ObjectProperty)
    if (p.type !== "Property") continue;
    const prop = p as ObjectProperty;
    if (prop.key.type !== "Identifier" || (prop.key as { name: string }).name !== "name") continue;
    const val = unwrapParens(prop.value as Node);
    if (val.type !== "Literal") continue;
    if (typeof (val as { value: unknown }).value === "string") {
      return (val as { value: string }).value;
    }
  }
  return null;
}

function tryParseOxc(src: string): Program | null {
  try {
    const result = parseSync("inline.ts", src);
    return result.program;
  } catch {
    return null;
  }
}

function pascalFromFilename(filePath: string): string {
  const stem = basename(filePath, extname(filePath));
  return stem.replace(/(^|[-_])(.)/g, (_, _sep, c) => c.toUpperCase());
}

function detectScriptDefineComponent(program: Program, source: string, filePath: string): LocalDefinition[] {
  const out: LocalDefinition[] = [];
  for (const stmt of program.body) {
    if (stmt.type !== "ExportDefaultDeclaration") continue;
    const decl = unwrapParens(stmt.declaration as Node);

    if (
      decl.type === "CallExpression" &&
      decl.callee.type === "Identifier" &&
      decl.callee.name === "defineComponent"
    ) {
      out.push({
        componentId: {
          kind: "vue-component",
          export: pascalFromFilename(filePath),
          source: { type: "local", filePath },
        },
        exportName: pascalFromFilename(filePath),
        isDefault: true,
        detector: "vue-define-component",
      });
    }

    if (
      decl.type === "ObjectExpression" &&
      hasSetupOrRender(decl as ObjectExpression)
    ) {
      out.push({
        componentId: {
          kind: "vue-component",
          export: pascalFromFilename(filePath),
          source: { type: "local", filePath },
        },
        exportName: pascalFromFilename(filePath),
        isDefault: true,
        detector: "vue-functional",
      });
    }
  }
  return out;
}

function hasSetupOrRender(obj: ObjectExpression): boolean {
  return obj.properties.some((p) => {
    // oxc uses `Property` (ObjectProperty interface) for object properties and method shorthands
    if (p.type !== "Property") return false;
    const prop = p as ObjectProperty;
    if (prop.key.type !== "Identifier") return false;
    const name = (prop.key as { name: string }).name;
    return name === "setup" || name === "render";
  });
}

/**
 * oxc preserves ParenthesizedExpression as a distinct node type.
 * Unwrap any number of wrapping parens to reach the inner expression.
 */
function unwrapParens(node: Node): Node {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = (current as { expression: Node }).expression;
  }
  return current;
}

// ---------------------------------------------------------------------------
// defineProps site discovery + declared-prop-API extraction
// ---------------------------------------------------------------------------

type DefinePropsSite = {
  typeArg?: TSType;
  runtimeArg?: ObjectExpression;
  destructure?: ObjectPattern;
  withDefaults?: ObjectExpression;
};

function isDefinePropsCall(node: Node): boolean {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "defineProps";
}

function typeAndRuntime(call: Extract<Node, { type: "CallExpression" }>): Pick<DefinePropsSite, "typeArg" | "runtimeArg"> {
  const first = call.arguments[0];
  return {
    ...(call.typeArguments?.params[0] ? { typeArg: call.typeArguments.params[0] } : {}),
    ...(first && first.type === "ObjectExpression" ? { runtimeArg: first } : {}),
  };
}

function siteFromInit(init: Node | null | undefined, id: Node | undefined): DefinePropsSite | null {
  if (!init) return null;
  const expr = unwrapParens(init);
  if (expr.type !== "CallExpression") return null;
  const destructure = id && id.type === "ObjectPattern" ? (id as ObjectPattern) : undefined;
  if (expr.callee.type === "Identifier" && expr.callee.name === "withDefaults") {
    const inner = expr.arguments[0];
    const defaults = expr.arguments[1];
    if (inner && isDefinePropsCall(inner)) {
      return {
        ...typeAndRuntime(inner as Extract<Node, { type: "CallExpression" }>),
        ...(destructure ? { destructure } : {}),
        ...(defaults && defaults.type === "ObjectExpression" ? { withDefaults: defaults } : {}),
      };
    }
    return null;
  }
  if (isDefinePropsCall(expr)) {
    return { ...typeAndRuntime(expr as Extract<Node, { type: "CallExpression" }>), ...(destructure ? { destructure } : {}) };
  }
  return null;
}

function findDefinePropsSite(program: Program): DefinePropsSite | null {
  for (const stmt of program.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        const site = siteFromInit(d.init, d.id as Node);
        if (site) return site;
      }
    } else if (stmt.type === "ExpressionStatement") {
      const site = siteFromInit(stmt.expression as Node, undefined);
      if (site) return site;
    }
  }
  return null;
}

function siteToDeclared(site: DefinePropsSite, scriptSource: string): DeclaredPropApi | undefined {
  let base: DeclaredPropApi | undefined;
  if (site.typeArg && site.typeArg.type === "TSTypeLiteral") {
    base = typeLiteralToDeclared(site.typeArg, scriptSource);
  } else if (site.runtimeArg) {
    base = objectRuntimeToDeclared(site.runtimeArg);
  }
  if (site.destructure) {
    const d = objectPatternToDeclared(site.destructure);
    if (!base) base = { props: {}, hasRest: false };
    base.hasRest = base.hasRest || d.hasRest;
    for (const [name, dp] of Object.entries(d.props)) {
      base.props[name] = {
        ...(base.props[name] ?? {}),
        ...(dp.default !== undefined ? { default: dp.default } : {}),
        ...(dp.required === false ? { required: false } : {}),
      };
    }
  }
  if (site.withDefaults && base) {
    for (const p of site.withDefaults.properties) {
      if (p.type !== "Property" || p.key.type !== "Identifier") continue;
      const lit = readLiteralValue(p.value as Expression);
      base.props[p.key.name] = {
        ...(base.props[p.key.name] ?? {}),
        required: false,
        ...(lit !== undefined ? { default: lit } : {}),
      };
    }
  }
  if (!base || Object.keys(base.props).length === 0) return undefined;
  return base;
}
