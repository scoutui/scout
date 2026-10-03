/**
 * Emit references for a single React/TSX file into the graph.
 *
 * A structural AST walker: it pattern-matches shapes without resolving them.
 * The engine gives them meaning when it resolves the InferredType algebra
 * after the walk.
 */
import type {
  Class,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ExportSpecifier,
  Expression,
  Function as OxcFunction,
  ImportDeclaration,
  JSXIdentifier as OxcJSXIdentifier,
  JSXMemberExpression as OxcJSXMemberExpression,
  JSXOpeningElement,
  Node as OxcNode,
  Program,
  StaticMemberExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "@oxc-project/types";
import { findEnclosingComponentBinding } from "./find-owner.js";
import { positionAt } from "./position.js";
import type { FileBuilder, InferredType, OccurrenceVia, Reference, ScopeId } from "@scoutui/reference-graph";
import { MODULE_SCOPE, isHostElementName } from "@scoutui/reference-graph";
import { ScopeTracker, walk } from "oxc-walker";
import {
  inferValue,
  extractFunctionReturns,
  extractClassRenderReturns,
  type ScopeForFn,
  type LocAt,
  type NamespaceMembers,
  memberChainRef,
  unwrapTsNoise,
} from "./infer-value.js";

/**
 * Span-keyed scope key for a function node, so value inference and the
 * declaration walk agree on the body's scope id. Every function-boundary
 * `pushScope` and every `inferValue` descent derives the key here.
 */
const fnScopeKey = (start: number) => `fn@${start}`;

/** ScopeForFn backed by the file builder's keyed-scope registry. */
const scopeForFnOf = (fb: FileBuilder): ScopeForFn => (start, parent) =>
  fb.scopeForNode(fnScopeKey(start), parent);

/** LocAt backed by the file's source text. See `LocAt` in infer-value.ts. */
const locAtOf = (source: string): LocAt => (offset) => positionAt(source, offset);
import { readJsxAttrs } from "./jsx-attrs.js";

const namespaceMembersByFile = new WeakMap<FileBuilder, NamespaceMembers>();

/** The file's namespace member chains. See `NamespaceMembers` in infer-value.ts. */
const namespaceMembersOf = (fb: FileBuilder): NamespaceMembers | undefined => namespaceMembersByFile.get(fb);

/** A static member access `a.b`: not computed, not a private field. */
function isStaticMember(n: OxcNode): n is StaticMemberExpression {
  return n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier";
}

/**
 * The outermost node of every static member chain (`NS.a.b`) whose root
 * identifier is, where it is read, an `import * as NS` of this file: no
 * nearer declaration, hoisted or not, shadows it. A chain on a call's callee
 * (`NS.a.b()`, `NS.a[k]()`, `(NS.a as T)()`) is left out.
 */
function namespaceMemberChains(ast: Program): NamespaceMembers {
  const namespaces = new Set<string>();
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    for (const spec of node.specifiers ?? []) {
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name);
    }
  }
  const chains = new Set<object>();
  if (namespaces.size === 0) return chains;
  const scopeTracker = new ScopeTracker({ preserveExitedScopes: true });
  walk(ast, { scopeTracker });
  scopeTracker.freeze();
  const callees = new Set<OxcNode>();
  walk(ast, {
    scopeTracker,
    enter(node, parent) {
      if (node.type === "CallExpression") {
        for (let c = unwrapTsNoise(node.callee); c?.type === "MemberExpression"; c = unwrapTsNoise(c.object)) callees.add(c);
        return;
      }
      if (!isStaticMember(node) || callees.has(node)) return;
      if (parent !== null && isStaticMember(parent) && parent.object === node) return;
      let root: OxcNode = node.object;
      while (isStaticMember(root)) root = root.object;
      if (root.type !== "Identifier" || !namespaces.has(root.name)) return;
      const decl = scopeTracker.getDeclaration(root.name);
      if (decl?.type === "Import" && decl.node.type === "ImportNamespaceSpecifier") chains.add(node);
    },
  });
  return chains;
}

const objectAssignCallsByFile = new WeakMap<FileBuilder, ReadonlySet<object>>();

/**
 * Every `Object.assign(A0, …)` call whose `Object` is, where it is read, the
 * global: no declaration, hoisted or not, binds `Object` there. A call with
 * no arguments, or whose first argument is a spread, is left out.
 */
function unboundObjectAssignCalls(ast: Program, source: string): ReadonlySet<object> {
  const calls = new Set<object>();
  if (!/\bObject\s*\.\s*assign\b/.test(source)) return calls;
  const scopeTracker = new ScopeTracker({ preserveExitedScopes: true });
  walk(ast, { scopeTracker });
  scopeTracker.freeze();
  walk(ast, {
    scopeTracker,
    enter(node) {
      if (node.type !== "CallExpression") return;
      const first = node.arguments[0];
      if (first === undefined || first.type === "SpreadElement") return;
      const callee = node.callee;
      if (!isStaticMember(callee) || callee.property.name !== "assign") return;
      if (callee.object.type !== "Identifier" || callee.object.name !== "Object") return;
      if (scopeTracker.getDeclaration("Object") === null) calls.add(node);
    },
  });
  return calls;
}

export type EmitOptions = {
  file: string;
  source: string;
  ast: Program;
  fileBuilder: FileBuilder;
};

export function emitReact(opts: EmitOptions): void {
  namespaceMembersByFile.set(opts.fileBuilder, namespaceMemberChains(opts.ast));
  objectAssignCallsByFile.set(opts.fileBuilder, unboundObjectAssignCalls(opts.ast, opts.source));
  const emitState: EmitState = {
    fileBuilder: opts.fileBuilder,
    pendingPropForwardBindings: [],
    ast: opts.ast,
    source: opts.source,
  };

  for (const node of opts.ast.body) {
    if (node.type === "ImportDeclaration") {
      emitImport(node as ImportDeclaration, opts.fileBuilder, opts.source);
    } else if (node.type === "VariableDeclaration") {
      emitVariableDeclaration(node as unknown as VariableDeclaration, opts.fileBuilder, opts.source, emitState);
    } else if (
      node.type === "FunctionDeclaration" ||
      node.type === "TSDeclareFunction"
    ) {
      emitFunctionDeclaration(node as unknown as OxcFunction, opts.fileBuilder, opts.source);
    } else if (
      node.type === "ClassDeclaration" ||
      node.type === "ClassExpression"
    ) {
      emitClassDeclaration(node as unknown as Class, opts.fileBuilder, opts.source);
    } else if (node.type === "ExportNamedDeclaration") {
      emitExportNamed(node as unknown as ExportNamedDeclaration, opts.fileBuilder, opts.source, emitState);
    } else if (node.type === "ExportDefaultDeclaration") {
      emitExportDefault(node as unknown as ExportDefaultDeclaration, opts.fileBuilder, opts.source);
    } else if (node.type === "ExportAllDeclaration") {
      emitExportAll(node as unknown as ExportAllDeclaration, opts.fileBuilder);
    } else {
      // Any other module-scope statement (`root.render(<App/>)`,
      // `List.Item = Item`, an `if` around either). JSX here is
      // a usage with no owner; identifiers read as values are held.
      if (isUnrecordedExport(node as unknown as OxcNode)) opts.fileBuilder.markUnrecordedExports();
      walkJsxIn(node as unknown as OxcNode, opts.fileBuilder, opts.source, null);
    }
  }

  // Second pass: prop-forward finalize.
  finalizePropForwardBindings(emitState);
}

// ---------------------------------------------------------------------------
// Import emission
// ---------------------------------------------------------------------------

function emitImport(node: ImportDeclaration, fb: FileBuilder, source: string): void {
  const specifier = node.source.value;
  const pos = positionAt(source, node.start);
  const loc = { line: pos.line, column: pos.column + 1 };

  // Side-effect import: no binding to emit.
  if (!node.specifiers || node.specifiers.length === 0) return;

  for (const spec of node.specifiers) {
    if (spec.type === "ImportSpecifier") {
      // `imported` is ModuleExportName: IdentifierName | IdentifierReference | StringLiteral
      // IdentifierName / IdentifierReference have `.name`; StringLiteral has `.value`
      const imported =
        spec.imported.type === "Identifier"
          ? (spec.imported as { name: string }).name
          : String((spec.imported as { value: unknown }).value);
      fb.addImport({ specifier, imported, local: spec.local.name, loc });
    } else if (spec.type === "ImportDefaultSpecifier") {
      fb.addImport({ specifier, imported: "default", local: spec.local.name, loc });
    } else if (spec.type === "ImportNamespaceSpecifier") {
      fb.addImport({ specifier, imported: "*", local: spec.local.name, loc });
    }
  }
}

// ---------------------------------------------------------------------------
// JSX walking helpers
// ---------------------------------------------------------------------------

/**
 * Decompose a JSX element name into symbol + memberChain.
 * `<Foo />` → { symbol: "Foo", memberChain: [] }
 * `<Foo.Bar.Baz />` → { symbol: "Foo", memberChain: ["Bar", "Baz"] }
 * Returns null for JSXNamespacedName (skip those).
 */
function decomposeJsxName(
  node: OxcJSXIdentifier | OxcJSXMemberExpression | OxcNode,
): { symbol: string; memberChain: string[] } | null {
  if (node.type === "JSXIdentifier") {
    return { symbol: (node as OxcJSXIdentifier).name, memberChain: [] };
  }
  if (node.type === "JSXMemberExpression") {
    const parts: string[] = [];
    let current: OxcNode = node;
    while (current.type === "JSXMemberExpression") {
      const mem = current as OxcJSXMemberExpression;
      parts.unshift(mem.property.name);
      current = mem.object as OxcNode;
    }
    if (current.type !== "JSXIdentifier") return null;
    return { symbol: (current as OxcJSXIdentifier).name, memberChain: parts };
  }
  // JSXNamespacedName: skipped.
  return null;
}

/**
 * Walk an arbitrary AST subtree looking for JSXOpeningElement nodes.
 * For each found, emit a JsxUsage via fb.addJsxUsage and, if currentOwner is
 * non-null, wire it via fb.setOwner.
 */
function walkJsxIn(
  node: OxcNode | null | undefined,
  fb: FileBuilder,
  source: string,
  currentOwner: Reference | null,
  pos?: WalkPosition,
): void {
  if (node == null) return;
  // A held reference: an identifier read as a value.
  // `isValuePosition` says which positions count. Only a name React could
  // render as a component is recorded (the roster's own rule).
  if (node.type === "Identifier" && pos !== undefined && !pos.inPattern && isValuePosition(pos.parent, pos.key)) {
    const name = (node as unknown as { name: string }).name;
    if (!isHostElementName(name)) {
      fb.addHeldRef({
        symbol: name,
        memberChain: [],
        loc: positionAt(source, (node as unknown as { start: number }).start),
        originFile: fb.filePath,
      });
    }
  }
  // JSXElement: the opening element emits the usage, then the children.
  if (node.type === "JSXElement") {
    const jsxEl = node as unknown as {
      openingElement: OxcNode;
      closingElement: OxcNode | null;
      children: OxcNode[];
    };
    walkJsxIn(jsxEl.openingElement, fb, source, currentOwner);
    for (const child of jsxEl.children) {
      walkJsxIn(child, fb, source, currentOwner, { parent: node, key: "children", inPattern: false });
    }
    // Closing element has no usages of its own.
    return;
  }
  // JSXFragment (`<>...</>`): emits no usage of its own.
  if (node.type === "JSXFragment") {
    const frag = node as unknown as { children: OxcNode[] };
    for (const child of frag.children) {
      walkJsxIn(child, fb, source, currentOwner);
    }
    return;
  }
  if (node.type === "JSXOpeningElement") {
    const opening = node as JSXOpeningElement;
    const decomposed = decomposeJsxName(opening.name as OxcNode);
    if (decomposed) {
      const pos = positionAt(source, opening.start);
      const loc = { line: pos.line, column: pos.column };
      fb.addJsxUsage({
        ref: {
          symbol: decomposed.symbol,
          memberChain: decomposed.memberChain,
          scope: fb.currentScope(),
          loc,
          originFile: fb.filePath,
        },
        loc,
        props: readJsxAttrs(opening),
      });
      if (currentOwner !== null) {
        fb.setOwner(currentOwner);
      }
    }
  }
  if (node.type === "ExpressionStatement") emitMemberAssignment(node, fb, source);
  if (node.type === "CallExpression" && objectAssignCallsByFile.get(fb)?.has(node)) {
    const target = (node as unknown as { arguments: OxcNode[] }).arguments[0];
    if (target?.type === "Identifier") {
      fb.addUnrecordedMemberWrite({ symbol: target.name, memberChain: [], loc: positionAt(source, target.start), originFile: fb.filePath });
    }
  }
  if (node.type === "VariableDeclaration") {
    const varDecl = node as unknown as VariableDeclaration;
    for (const declr of varDecl.declarations as VariableDeclarator[]) {
      if (declr.id.type !== "Identifier") {
        emitDestructure(declr, fb, source);
        continue;
      }
      const id = declr.id as unknown as { name: string };
      emitDeclarationFromDeclarator(declr, fb, source, { file: fb.filePath });
    }
    // Fall through to the generic recursion below so we still walk into initializers
    // for JSX usages, nested function bodies, and further VariableDeclarations.
  }
  // A catch clause's parameter is bound to the thrown value, which the graph
  // cannot name: declared as Unknown, a render of it is never an unbound name.
  if (node.type === "CatchClause") {
    const param = (node as unknown as { param: OxcNode | null }).param;
    if (param !== null) {
      for (const leaf of extractBindingsFromPattern(param, { kind: "Unknown" }, source)) {
        fb.addDeclaration({ symbol: leaf.symbol, value: leaf.value, loc: leaf.loc, isExported: false });
      }
    }
  }
  // Nested function, arrow or function expression: push a scope and emit its
  // params, then walk the body. This registers `Item` in a render-prop arrow
  // like `<DL>{(Item) => <Item.X />}</DL>`, and keeps a nested function's
  // params in its own scope. Top-level FunctionDeclarations go through
  // `emitFunctionDeclaration` instead; this branch only sees nested ones.
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) {
    const fnNode = node as unknown as { params: OxcNode[]; body: OxcNode; id?: { name: string }; start: number };
    const refSymbol = fnNode.id?.name ?? `<arrow@${fnNode.start}>`;
    const fnRef: Reference = {
      symbol: refSymbol,
      scope: fb.currentScope(),
      memberChain: [],
      loc: positionAt(source, fnNode.start),
      originFile: fb.filePath,
    };
    fb.pushScope(fnScopeKey(fnNode.start));
    try {
      emitParameterBindings(fnNode.params, fnRef, fb, source);
      walkJsxIn(fnNode.body, fb, source, currentOwner, { parent: node, key: "body", inPattern: false });
    } finally {
      fb.popScope();
    }
    return; // The body is already walked: skip the generic recursion.
  }
  // Recurse into all child nodes, telling each where it sits in its parent.
  const inPattern = (pos?.inPattern ?? false) || isBindingPattern(node);
  for (const [key, val] of Object.entries(node)) {
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child !== null && typeof child === "object" && typeof (child as OxcNode).type === "string") {
          walkJsxIn(child as OxcNode, fb, source, currentOwner, { parent: node, key, inPattern });
        }
      }
    } else if (val !== null && typeof val === "object" && typeof (val as OxcNode).type === "string") {
      walkJsxIn(val as OxcNode, fb, source, currentOwner, { parent: node, key, inPattern });
    }
  }
}

/** Record `X.m = v`, where `X` is an identifier and `m` a static name, as a
 *  member assignment on `X` at the current scope. Any other assignment to a
 *  member of a name (`(X as any).m = v`, `X[k] = v`, `X.a.b = v`, `X.m += v`)
 *  records that name as an unrecorded member write. */
function emitMemberAssignment(statement: OxcNode, fb: FileBuilder, source: string): void {
  const expr = (statement as unknown as { expression: OxcNode }).expression;
  if (expr.type !== "AssignmentExpression") return;
  const left = expr.left as unknown as OxcNode;
  if (expr.operator !== "=" || !isStaticMember(left) || left.object.type !== "Identifier") {
    const root = memberWriteRoot(left);
    if (root !== null) {
      fb.addUnrecordedMemberWrite({ symbol: root.name, memberChain: [], loc: positionAt(source, root.start), originFile: fb.filePath });
    }
    return;
  }
  const holder = left.object.name;
  fb.addMemberAssignment({
    holder: { symbol: holder, memberChain: [], loc: positionAt(source, left.object.start), originFile: fb.filePath },
    member: left.property.name,
    value: inferValue(
      expr.right,
      fb.currentScope(),
      fb.filePath,
      { file: fb.filePath },
      scopeForFnOf(fb),
      locAtOf(source),
      namespaceMembersOf(fb),
    ),
    loc: positionAt(source, expr.start),
  });
}

/** The identifier a member write's target is rooted at, through member
 *  accesses and TS casts (`(X as any).a[k]`); null for a target that is not a
 *  member of a name. */
function memberWriteRoot(target: OxcNode): { name: string; start: number } | null {
  let current = unwrapTsNoise(target as unknown as Expression) as unknown as OxcNode | null | undefined;
  if (current?.type !== "MemberExpression") return null;
  while (current?.type === "MemberExpression") {
    current = unwrapTsNoise((current as unknown as { object: Expression }).object) as unknown as OxcNode | null | undefined;
  }
  return current?.type === "Identifier" ? (current as unknown as { name: string; start: number }) : null;
}

/** Where a walked node sits in its parent, for `isValuePosition`. `inPattern`
 *  is true anywhere under a binding pattern, where identifiers are declared,
 *  not read. */
type WalkPosition = { parent: OxcNode; key: string; inPattern: boolean };

const isBindingPattern = (node: OxcNode): boolean => node.type.endsWith("Pattern") || node.type === "RestElement";

/**
 * The value-position rule: is an `Identifier` child at
 * `key` of `parent` read as a value? Stated as the exclusions, in grammar
 * order; everything not excluded is a hold: call arguments, object property
 * values (shorthand included), array elements, assignment right-hand sides,
 * return values, conditional and logical operands, JSX attribute and child
 * expressions, spread arguments, a class's `extends`.
 */
function isValuePosition(parent: OxcNode, key: string): boolean {
  const t = parent.type;
  // Inside a type node only `x as T`, `x satisfies T` and `x!` carry a value.
  if (t.startsWith("TS")) return key === "expression";
  if (t.endsWith("Specifier")) return false;
  if (t.startsWith("JSX")) return key === "expression" || key === "argument";
  switch (key) {
    case "callee":
      return t !== "CallExpression" && t !== "NewExpression";
    case "object":
    case "property":
      return t !== "MemberExpression";
    case "key":
      if (t === "Property") return (parent as unknown as { computed?: boolean }).computed === true;
      return t !== "MethodDefinition" && t !== "PropertyDefinition";
    case "left":
      return t !== "AssignmentExpression";
    case "argument":
      return t !== "UpdateExpression";
    case "id":
    case "params":
    case "param":
    case "label":
    case "typeAnnotation":
    case "typeParameters":
    case "typeArguments":
    case "returnType":
      return false;
    default:
      return true;
  }
}

/** Walk a wrapper call's arguments after the first with no owner, so
 *  `forwardRef(fn, Other)` still holds `Other` once the first argument's body
 *  has been walked with the holder as owner. */
function walkRemainingArguments(call: { arguments: OxcNode[] }, callNode: OxcNode, fb: FileBuilder, source: string): void {
  for (const arg of call.arguments.slice(1)) {
    walkJsxIn(arg, fb, source, null, { parent: callNode, key: "arguments", inPattern: false });
  }
}

/**
 * Walk the body of a top-level function looking for identifier-callee
 * CallExpressions and emit one `fb.addBodyCall` entry per call found.
 * Does not descend into nested ArrowFunctionExpression / FunctionExpression /
 * FunctionDeclaration bodies: only the lexical body of the owning top-level
 * function is walked.
 *
 * Only Identifier callees are recorded (member-expression calls like
 * `this.foo()` or `a.b()` are skipped): the helper-caller index needs only
 * direct identifier calls.
 */
function walkBodyCalls(node: OxcNode | null | undefined, fb: FileBuilder, source: string, ownerSymbol: string): void {
  if (node == null) return;

  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) {
    return;
  }

  if (node.type === "CallExpression") {
    const call = node as unknown as { callee: OxcNode; arguments: OxcNode[] };
    if (call.callee.type === "Identifier") {
      const id = call.callee as unknown as { name: string; start: number };
      // The callee and the arguments carry the function body's scope: every
      // caller runs this walk inside the function's `pushScope`.
      const refAt = (name: string, start: number, scope: ScopeId): Reference => {
        const at = positionAt(source, start);
        return { symbol: name, memberChain: [], loc: { line: at.line, column: at.column }, originFile: fb.filePath, scope };
      };
      const args: InferredType[] = call.arguments.map((arg) => {
        if (arg.type !== "Identifier") return { kind: "Unknown" };
        const ident = arg as unknown as { name: string; start: number };
        return { kind: "TypeOf", ref: refAt(ident.name, ident.start, fb.currentScope()) };
      });
      fb.addBodyCall({ ownerSymbol, callee: refAt(id.name, id.start, fb.currentScope()), args });
    }
    // Still recurse into arguments and callee (e.g. IIFE or chained calls)
    // but the boundary check above prevents descent into nested function bodies.
  }

  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child !== null && typeof child === "object" && typeof (child as OxcNode).type === "string") {
          walkBodyCalls(child as OxcNode, fb, source, ownerSymbol);
        }
      }
    } else if (val !== null && typeof val === "object" && typeof (val as OxcNode).type === "string") {
      walkBodyCalls(val as OxcNode, fb, source, ownerSymbol);
    }
  }
}

// ---------------------------------------------------------------------------
// Dynamic-binding helpers
// ---------------------------------------------------------------------------

export type PatternLeaf = {
  symbol: string;
  value: InferredType;
  loc: { line: number; column: number };
};

/**
 * Walk a function-parameter or destructure pattern AST node, yielding one
 * PatternLeaf per leaf Identifier. The `source` InferredType describes the
 * value being destructured (e.g. `ParameterOf(fnRef, i)` or the call-return
 * type for `const { X } = useFoo()`). Leaves carry MemberOf chains over
 * `source` keyed by destructure path.
 *
 * `sourceText` is needed to compute `positionAt` for each leaf identifier.
 */
export function extractBindingsFromPattern(
  pattern: OxcNode,
  source: InferredType,
  sourceText: string,
): PatternLeaf[] {
  const out: PatternLeaf[] = [];

  const recurse = (node: OxcNode, src: InferredType): void => {
    switch (node.type) {
      case "Identifier": {
        const id = node as unknown as { name: string; start: number };
        const pos = positionAt(sourceText, id.start);
        out.push({ symbol: id.name, value: src, loc: { line: pos.line, column: pos.column } });
        return;
      }
      case "ObjectPattern": {
        const op = node as unknown as { properties: Array<{ type: string }> };
        for (const prop of op.properties) {
          // OXC emits "Property" for binding patterns (BindingProperty), never "ObjectProperty"
          // which only appears in expression-context object literals.
          if (prop.type === "Property") {
            const p = prop as unknown as { key: { type: string; name?: string; value?: string }; value: OxcNode; shorthand?: boolean; computed?: boolean };
            if (p.computed) continue; // computed keys carry no static member name
            const keyName = p.key.type === "Identifier" && p.key.name !== undefined ? p.key.name : String(p.key.value);
            recurse(p.value, { kind: "MemberOf", obj: src, member: keyName });
          } else if (prop.type === "RestElement") {
            const r = prop as unknown as { argument: OxcNode };
            recurse(r.argument, src);
          }
        }
        return;
      }
      case "ArrayPattern": {
        const ap = node as unknown as { elements: Array<OxcNode | null> };
        for (let i = 0; i < ap.elements.length; i++) {
          const el = ap.elements[i];
          if (el == null) continue; // sparse holes
          if (el.type === "RestElement") {
            const r = el as unknown as { argument: OxcNode };
            recurse(r.argument, src);
          } else {
            // Index labels are decorative: MemberOf over an Array in resolve-type.ts
            // fans out to all elements at resolve time regardless of `member`.
            recurse(el, { kind: "MemberOf", obj: src, member: String(i) });
          }
        }
        return;
      }
      case "AssignmentPattern": {
        const ap = node as unknown as { left: OxcNode };
        recurse(ap.left, src);
        return;
      }
      case "RestElement": {
        const r = node as unknown as { argument: OxcNode };
        recurse(r.argument, src);
        return;
      }
      // Other pattern shapes (TSParameterProperty, etc) are not in scope.
    }
  };

  recurse(pattern, source);
  return out;
}

/**
 * Emit one BindingDecl per leaf in each function parameter, valued as a
 * MemberOf chain over `ParameterOf(fnRef, paramIndex)`. The engine substitutes
 * these through its argument map when a call binds the parameter; a reference
 * to an unbound parameter resolves to no JSX terminal and emits nothing.
 *
 * Call this after `fb.pushScope()` so the bindings land in the function's
 * body scope (not the caller's scope).
 */
function emitParameterBindings(
  params: ReadonlyArray<OxcNode>,
  fnRef: Reference,
  fb: FileBuilder,
  sourceText: string,
): void {
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (!param) continue;
    const paramSource: InferredType = { kind: "ParameterOf", fn: fnRef, index: i };
    const leaves = extractBindingsFromPattern(param, paramSource, sourceText);
    for (const leaf of leaves) {
      fb.addDeclaration({
        symbol: leaf.symbol,
        value: leaf.value,
        loc: leaf.loc,
        isExported: false,
      });
    }
  }
}

/**
 * Record one declaration per leaf of a destructure (`const { Cell } = Table`).
 * Over a name or a static member chain, a leaf is that reference extended by
 * the pattern's keys (`TypeOf(Table, ["Cell"])`, the reference `<Table.Cell/>`
 * makes); under an array pattern it is a `MemberOf` over that reference, and a
 * rest element is the reference itself. Over any other initialiser, or none (a
 * `for…of` head), each leaf is a `MemberOf` over the initialiser's value, as
 * `extractBindingsFromPattern` builds it. Computed keys are skipped.
 */
function emitDestructure(declr: VariableDeclarator, fb: FileBuilder, source: string): void {
  const pattern = declr.id as unknown as OxcNode;
  const init = unwrapTsNoise(declr.init);
  const root = init ? memberChainRef(init, fb.currentScope(), fb.filePath, locAtOf(source)) : null;
  const leaves =
    root !== null
      ? extractChainLeaves(pattern, root, source)
      : extractBindingsFromPattern(
          pattern,
          inferValue(declr.init, fb.currentScope(), fb.filePath, undefined, scopeForFnOf(fb), locAtOf(source), namespaceMembersOf(fb)),
          source,
        );
  for (const leaf of leaves) {
    fb.addDeclaration({ symbol: leaf.symbol, value: leaf.value, loc: leaf.loc, isExported: false });
  }
}

/** The leaves of a destructure over a reference, each extending the reference's member chain by its keys. */
function extractChainLeaves(
  pattern: OxcNode,
  root: Extract<InferredType, { kind: "TypeOf" }>,
  sourceText: string,
): PatternLeaf[] {
  if (pattern.type === "AssignmentPattern") {
    return extractChainLeaves((pattern as unknown as { left: OxcNode }).left, root, sourceText);
  }
  if (pattern.type !== "ObjectPattern") return extractBindingsFromPattern(pattern, root, sourceText);
  const out: PatternLeaf[] = [];
  for (const prop of (pattern as unknown as { properties: Array<{ type: string }> }).properties) {
    if (prop.type === "RestElement") {
      out.push(...extractBindingsFromPattern(prop as unknown as OxcNode, root, sourceText));
      continue;
    }
    if (prop.type !== "Property") continue;
    const p = prop as unknown as { key: { type: string; name?: string; value?: string }; value: OxcNode; computed?: boolean };
    if (p.computed) continue;
    const keyName = p.key.type === "Identifier" && p.key.name !== undefined ? p.key.name : String(p.key.value);
    const ref = { ...root.ref, memberChain: [...root.ref.memberChain, keyName] };
    out.push(...extractChainLeaves(p.value, { kind: "TypeOf", ref }, sourceText));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prop-forward helpers
// ---------------------------------------------------------------------------

/**
 * True if the given node type is a JSX expression that produces a React
 * element value. Used to detect module-scope `const X = <JSX/>` bindings
 * whose JSX construction site needs prop-forward owner attribution.
 */
function isJsxTypeInit(nodeType: string): boolean {
  return nodeType === "JSXElement" || nodeType === "JSXFragment";
}

/**
 * Extract the root identifier from a JSX init expression.
 * Returns the root binding name (`<Foo.Bar />` → `"Foo"`) or null for
 * JSXFragment / namespaced names (no static root identifier).
 */
function rootSymbolOfJsxInit(init: OxcNode): string | null {
  if (init.type !== "JSXElement") return null;
  const opening = (init as unknown as { openingElement: { name: OxcNode } }).openingElement;
  const decomposed = decomposeJsxName(opening.name);
  return decomposed?.symbol ?? null;
}

type PendingPropForwardBinding = {
  symbol: string;
  scope: ScopeId;
  /** Line + column of the module-scope `const X = <JSX/>` declaration. */
  constructionLoc: { line: number; column: number };
  /** Position of the root JSXOpeningElement (used to match the JsxUsage
   *  emitted by walkJsxIn, which uses the opening-element position). */
  jsxRootLoc: { line: number; column: number };
  /** Half-open range `[usageIdxStart, usageIdxEnd)` of JsxUsage indices
   *  emitted while walking the binding's init. Includes the root opening
   *  element and any nested JSX (e.g. `<Provider><Notification/></Provider>`
   *  emits two usages). All ownership entries in this range are re-attributed
   *  at finalize; for multi-read fan-out the whole range is cloned per
   *  additional read site so nested-usage counts stay accurate. */
  usageIdxStart: number;
  usageIdxEnd: number;
};

type EmitState = {
  fileBuilder: FileBuilder;
  pendingPropForwardBindings: PendingPropForwardBinding[];
  ast: Program;
  source: string;
};

/**
 * A read of a pending binding and its enclosing component's owner ref, found
 * by `findEnclosingComponentBinding` in `./find-owner.ts` (HOC unwrapping,
 * PascalCase and default-export rules).
 */
type ReadSite = {
  pendingIdx: number;
  ownerRef: Reference;
};

/**
 * Scan the file AST for Identifier reads that resolve to a pending prop-forward
 * binding. Returns one ReadSite per matching read, recording the enclosing
 * component as the owner attribution target.
 */
function findPropForwardReadSites(emitState: EmitState): ReadSite[] {
  const sites: ReadSite[] = [];
  const pending = emitState.pendingPropForwardBindings;
  if (pending.length === 0) return sites;

  const pendingNames = new Set(pending.map((p) => p.symbol));

  walk(emitState.ast as unknown as Parameters<typeof walk>[0], {
    enter(node, parent) {
      if (node.type !== "Identifier") return;
      const idName = (node as unknown as { name: string }).name;
      if (!pendingNames.has(idName)) return;

      if (isWritePosition(node as OxcNode, parent as OxcNode | null)) return;

      const enclosing = findEnclosingComponentBinding(node as unknown as OxcNode, emitState.ast);
      if (!enclosing) return;

      // Shadowing check: skip if a closer-enclosing scope re-binds the name.
      if (isShadowedByInnerScope(emitState.ast, node as unknown as OxcNode, idName)) return;

      const pendingIdx = pending.findIndex((p) => p.symbol === idName);
      if (pendingIdx === -1) return;

      const ownerRef: Reference = {
        symbol: enclosing.name,
        scope: MODULE_SCOPE,
        memberChain: [],
        loc: enclosing.loc ?? { line: 0, column: 0 },
        originFile: emitState.fileBuilder.filePath,
      };
      sites.push({ pendingIdx, ownerRef });
    },
  });

  return sites;
}

/**
 * Returns true if `outerName` is shadowed by a closer-enclosing declaration
 * between the read site (`identifierNode`) and module scope. Used by the
 * prop-forward second-pass to skip reads that bind to an inner declaration
 * rather than the outer module-scope binding.
 *
 * Scans only the innermost enclosing function's parameters and the top-level
 * VariableDeclarations of its body, so it misses block-scoped shadowing (a
 * `let` inside an `if` or `for`).
 */
function isShadowedByInnerScope(
  ast: Program,
  identifierNode: OxcNode,
  outerName: string,
): boolean {
  let stopped = false;
  let shadowed = false;
  const fnStack: OxcNode[] = [];

  walk(ast as unknown as Parameters<typeof walk>[0], {
    enter(node) {
      if (stopped) return;
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        fnStack.push(node as unknown as OxcNode);
      }
      if (node === identifierNode) {
        stopped = true;
        const innermostFn = fnStack[fnStack.length - 1];
        if (!innermostFn) return;

        // Check params for a binding named outerName.
        const params = (innermostFn as unknown as { params?: OxcNode[] }).params ?? [];
        for (const param of params) {
          if (containsBindingName(param, outerName)) {
            shadowed = true;
            return;
          }
        }

        // Check top-level VariableDeclarations within the function body.
        const body = (innermostFn as unknown as { body?: { body?: OxcNode[]; type: string } }).body;
        if (body && body.type === "BlockStatement" && Array.isArray(body.body)) {
          for (const stmt of body.body) {
            if (stmt.type === "VariableDeclaration") {
              const decls = (stmt as unknown as { declarations: Array<{ id: OxcNode }> }).declarations;
              for (const d of decls) {
                if (containsBindingName(d.id, outerName)) {
                  shadowed = true;
                  return;
                }
              }
            }
          }
        }
      }
    },
    leave(node) {
      if (stopped) return;
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        fnStack.pop();
      }
    },
  });
  return shadowed;
}

/** True if the given pattern binds `name`, as an identifier or any leaf of a
 *  destructure, default or rest element. */
function containsBindingName(pattern: OxcNode, name: string): boolean {
  if (pattern.type === "Identifier") {
    return (pattern as unknown as { name: string }).name === name;
  }
  if (pattern.type === "ObjectPattern") {
    const props = (pattern as unknown as { properties: Array<{ value?: OxcNode; argument?: OxcNode }> }).properties;
    for (const p of props) {
      if (p.value && containsBindingName(p.value, name)) return true;
      if (p.argument && containsBindingName(p.argument, name)) return true;
    }
  }
  if (pattern.type === "ArrayPattern") {
    const elements = (pattern as unknown as { elements: Array<OxcNode | null> }).elements;
    for (const el of elements) {
      if (el && containsBindingName(el, name)) return true;
    }
  }
  if (pattern.type === "AssignmentPattern") {
    return containsBindingName((pattern as unknown as { left: OxcNode }).left, name);
  }
  if (pattern.type === "RestElement") {
    return containsBindingName((pattern as unknown as { argument: OxcNode }).argument, name);
  }
  return false;
}

/**
 * True when the Identifier is in a "write" position (declaration, assignment
 * target, static property key, static member access property, import name)
 * rather than a "read" position. Used to filter out non-read appearances of
 * the binding name during the prop-forward second-pass scan.
 */
function isWritePosition(node: OxcNode, parent: OxcNode | null): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "VariableDeclarator":
      return (parent as unknown as { id: OxcNode }).id === node;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return (parent as unknown as { id?: OxcNode }).id === node;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return true;
    case "Property": {
      const p = parent as unknown as { key: OxcNode; computed?: boolean };
      return p.key === node && p.computed !== true;
    }
    case "MemberExpression": {
      const p = parent as unknown as { property: OxcNode; computed?: boolean };
      return p.property === node && p.computed !== true;
    }
    case "AssignmentExpression":
      return (parent as unknown as { left: OxcNode }).left === node;
    default:
      return false;
  }
}

/**
 * Finalize prop-forward attribution. For each pending binding that has at
 * least one read site, re-attribute every JsxUsage in the binding's
 * construction range `[usageIdxStart, usageIdxEnd)` to the read site's
 * enclosing component.
 *
 * Range-clone semantics: when a binding is read in N components, every usage
 * in the range is cloned (N − 1) additional times so nested children
 * fan out too (e.g. `<Provider><Notification/></Provider>` emits two usages,
 * and both are cloned per read site). The engine emits one occurrence per
 * (jsxUsage, ownership) pair, so cloning produces accurate per-component
 * occurrence counts even when the binding wraps the subject in a tracked
 * structural component.
 *
 * Pending bindings with no read sites are left alone (orphan signal
 * preserved).
 */
function finalizePropForwardBindings(emitState: EmitState): void {
  const sites = findPropForwardReadSites(emitState);
  if (sites.length === 0) return;

  const byBinding = new Map<number, ReadSite[]>();
  for (const site of sites) {
    const list = byBinding.get(site.pendingIdx) ?? [];
    list.push(site);
    byBinding.set(site.pendingIdx, list);
  }

  const fb = emitState.fileBuilder;
  for (const [pendingIdx, readSites] of byBinding) {
    const pending = emitState.pendingPropForwardBindings[pendingIdx];
    if (!pending) continue;
    const via: OccurrenceVia = {
      kind: "prop-forward",
      bindingName: pending.symbol,
      constructionSite: {
        file: fb.filePath,
        line: pending.constructionLoc.line,
        column: pending.constructionLoc.column,
      },
    };

    // First read site: re-attribute every ownership entry in the range
    // [usageIdxStart, usageIdxEnd) in place via setOwnerAt. Covers both the
    // root JSX and any nested children.
    const firstSite = readSites[0];
    if (!firstSite) continue;
    for (let i = pending.usageIdxStart; i < pending.usageIdxEnd; i++) {
      fb.setOwnerAt(i, firstSite.ownerRef, via);
    }

    // Additional read sites: clone the entire range. Each clone gets its
    // own ownership entry attributed to the additional read site's enclosing
    // component, so nested usages fan out correctly across multiple consumers.
    for (let s = 1; s < readSites.length; s++) {
      const site = readSites[s];
      if (!site) continue;
      for (let i = pending.usageIdxStart; i < pending.usageIdxEnd; i++) {
        const snapshot = fb.getJsxUsage(i);
        if (!snapshot) continue;
        fb.addJsxUsage(snapshot);
        fb.setOwner(site.ownerRef, via);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Declaration emission
// ---------------------------------------------------------------------------

function emitDeclarationFromDeclarator(
  declr: VariableDeclarator,
  fb: FileBuilder,
  source: string,
  enclosingBinding: { file: string },
  isExported = false,
): void {
  if (declr.id.type !== "Identifier") return;
  const id = declr.id as unknown as { name: string };
  const loc = positionAt(source, declr.start);
  const infer = (expr: Expression | null | undefined) =>
    inferValue(expr, fb.currentScope(), fb.filePath, enclosingBinding, scopeForFnOf(fb), locAtOf(source), namespaceMembersOf(fb));
  const init = unwrapTsNoise(declr.init);
  const assign = init?.type === "CallExpression" && objectAssignCallsByFile.get(fb)?.has(init) ? init : null;
  fb.addDeclaration({
    symbol: id.name,
    value: infer(assign ? (assign.arguments[0] as Expression) : declr.init),
    loc,
    isExported,
  });
  if (assign) emitObjectAssignMembers(assign.arguments.slice(1), id.name, fb, source, infer);
}

/** Record each static-keyed property of every object-literal source of an
 *  `Object.assign` as a member assignment on `holder`. A source that is not
 *  an object literal, a spread and a computed key record `holder` as an
 *  unrecorded member write. */
function emitObjectAssignMembers(
  sources: readonly OxcNode[],
  holder: string,
  fb: FileBuilder,
  source: string,
  infer: (expr: Expression) => InferredType,
): void {
  const unrecorded = (node: OxcNode) =>
    fb.addUnrecordedMemberWrite({ symbol: holder, memberChain: [], loc: positionAt(source, node.start), originFile: fb.filePath });
  for (const src of sources) {
    const obj = unwrapTsNoise(src as Expression);
    if (obj?.type !== "ObjectExpression") {
      unrecorded(src);
      continue;
    }
    for (const prop of obj.properties) {
      if (prop.type !== "Property" || prop.computed) {
        unrecorded(prop as unknown as OxcNode);
        continue;
      }
      const key = prop.key;
      const name = key.type === "Identifier" ? key.name : key.type === "Literal" && typeof key.value === "string" ? key.value : null;
      if (name === null) continue;
      const at = positionAt(source, prop.start);
      fb.addMemberAssignment({
        holder: { symbol: holder, memberChain: [], loc: at, originFile: fb.filePath },
        member: name,
        value: infer(prop.value),
        loc: at,
      });
    }
  }
}

function emitVariableDeclaration(
  node: VariableDeclaration,
  fb: FileBuilder,
  source: string,
  emitState: EmitState,
): void {
  for (const declr of node.declarations as VariableDeclarator[]) {
    if (declr.id.type !== "Identifier") {
      emitDestructure(declr, fb, source);
      // The init is still walked: an IIFE body declares and renders like any
      // other, with no owner at module scope.
      walkJsxIn(declr.init as unknown as OxcNode | null, fb, source, null, {
        parent: declr as unknown as OxcNode,
        key: "init",
        inPattern: false,
      });
      continue;
    }
    const id = declr.id as unknown as { name: string };
    const loc = positionAt(source, declr.start);
    emitDeclarationFromDeclarator(declr, fb, source, { file: fb.filePath });
    if (declr.init != null) {
      // Unwrap parentheses: oxc keeps ParenthesizedExpression (Babel strips
      // it), so without this `const X = (<Y/>)` falls through to the catch-all
      // walk and skips the prop-forward / function-component / HOC detection
      // below. Loops for nested wraps (`((<Y/>))`).
      let init = declr.init as unknown as OxcNode;
      while (init.type === "ParenthesizedExpression") {
        init = (init as unknown as { expression: OxcNode }).expression;
      }
      const initType = init.type;
      const ownerRef: Reference = { symbol: id.name, scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
      if (initType === "ArrowFunctionExpression" || initType === "FunctionExpression") {
        // Variable holding a function component: walk its body with this symbol as owner.
        const fnLike = init as unknown as { params: OxcNode[]; body: OxcNode };
        const body = fnLike.body;
        const fnRef: Reference = { symbol: id.name, scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
        fb.pushScope(fnScopeKey((init as unknown as { start: number }).start));
        try {
          emitParameterBindings(fnLike.params, fnRef, fb, source);
          walkJsxIn(body, fb, source, ownerRef, { parent: init, key: "body", inPattern: false });
          walkBodyCalls(body, fb, source, id.name);
        } finally {
          fb.popScope();
        }
      } else if (initType === "CallExpression") {
        // HOC pattern: const Foo = memo(() => ...) / forwardRef((ref, props) => ...) etc.
        // Walk the first argument (inner function) body with this symbol as owner,
        // so JSX inside the HOC wrapper is attributed to the variable name.
        const call = init as unknown as { arguments: OxcNode[] };
        const firstArg = call.arguments[0];
        if (firstArg && (firstArg.type === "ArrowFunctionExpression" || firstArg.type === "FunctionExpression")) {
          const fnLike = firstArg as unknown as { params: OxcNode[]; body: OxcNode };
          const body = fnLike.body;
          const fnRef: Reference = { symbol: id.name, scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
          fb.pushScope(fnScopeKey((firstArg as unknown as { start: number }).start));
          try {
            emitParameterBindings(fnLike.params, fnRef, fb, source);
            walkJsxIn(body, fb, source, ownerRef, { parent: firstArg, key: "body", inPattern: false });
            walkBodyCalls(body, fb, source, id.name);
          } finally {
            fb.popScope();
          }
          walkRemainingArguments(call, init, fb, source);
        } else {
          // Non-HOC call expression: walk with no owner.
          walkJsxIn(init, fb, source, null);
        }
      } else if (isJsxTypeInit(initType) && fb.currentScope() === MODULE_SCOPE) {
        // Module-scope `const X = <JSX/>`: register a pending prop-forward
        // binding so the owner can be re-attributed at file finalize. Clone
        // data is captured here to keep FileBuilder write-only (apart from
        // the jsxUsageCount accessor).
        const rootSymbol = rootSymbolOfJsxInit(init);
        if (rootSymbol !== null) {
          const opening = (init as unknown as { openingElement: { name: OxcNode; start: number } }).openingElement;
          const decomposed = decomposeJsxName(opening.name);
          if (decomposed) {
            const openingPos = positionAt(source, opening.start);

            // Capture the JsxUsage range emitted by walking the init.
            // walkJsxIn descends depth-first; the first emitted usage is the
            // root JSX. Subsequent usages are nested children (e.g.
            // `<Provider><Notification/></Provider>` emits Provider then
            // Notification). The full range is re-attributed at finalize.
            const usageIdxStart = fb.jsxUsageCount();
            walkJsxIn(init, fb, source, null);
            const usageIdxEnd = fb.jsxUsageCount();

            if (usageIdxEnd > usageIdxStart) {
              emitState.pendingPropForwardBindings.push({
                symbol: id.name,
                scope: MODULE_SCOPE,
                constructionLoc: loc,
                jsxRootLoc: { line: openingPos.line, column: openingPos.column },
                usageIdxStart,
                usageIdxEnd,
              });
            }
          } else {
            // A JSX name that doesn't decompose (a namespaced name): walk
            // without registering.
            walkJsxIn(init, fb, source, null);
          }
        } else {
          // JSXFragment or other non-JSXElement init: no root symbol to track.
          walkJsxIn(init, fb, source, null);
        }
      } else {
        // Any other init, or JSX below module scope: walk with no owner.
        walkJsxIn(init, fb, source, null);
      }
    }
  }
}

function emitFunctionDeclaration(node: OxcFunction, fb: FileBuilder, source: string): void {
  if (!node.id) return;
  const loc = positionAt(source, node.start);
  const enclosingBinding = { file: fb.filePath };
  const bodyScope = fb.scopeForNode(fnScopeKey(node.start), fb.currentScope());
  fb.addDeclaration({
    symbol: node.id.name,
    value: {
      kind: "Function",
      returns: extractFunctionReturns(node.body, bodyScope, fb.filePath, enclosingBinding, scopeForFnOf(fb), locAtOf(source), namespaceMembersOf(fb)),
      enclosingBinding,
    },
    loc,
    isExported: false,
  });
  if (node.body) {
    const ownerRef: Reference = { symbol: node.id.name, scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
    const fnRef: Reference = { symbol: node.id.name, scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
    fb.pushScope(fnScopeKey(node.start));
    try {
      emitParameterBindings((node as unknown as { params: OxcNode[] }).params, fnRef, fb, source);
      walkJsxIn(node.body as unknown as OxcNode, fb, source, ownerRef);
      walkBodyCalls(node.body as unknown as OxcNode, fb, source, node.id.name);
    } finally {
      fb.popScope();
    }
  }
}

function emitClassDeclaration(node: Class, fb: FileBuilder, source: string): void {
  if (!node.id) return;
  const loc = positionAt(source, node.start);
  if (node.body.body.some((element) => element.type === "StaticBlock" || ("static" in element && element.static))) {
    fb.addUnrecordedMemberWrite({ symbol: node.id.name, memberChain: [], loc, originFile: fb.filePath });
  }
  const renderReturns = extractClassRenderReturns(node, fb.currentScope(), fb.filePath, scopeForFnOf(fb), locAtOf(source), namespaceMembersOf(fb));
  fb.addDeclaration({
    symbol: node.id.name,
    value: {
      kind: "Function",
      // A class with no `render` is not component-shaped: it returns
      // Unknown, not JSX, so a plain class is not a component candidate for
      // the registry.
      returns: renderReturns ?? [{ kind: "Unknown" }],
    },
    loc,
    isExported: false,
  });
  const ownerRef: Reference = { symbol: node.id.name, scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
  fb.pushScope();
  try {
    walkJsxIn(node as unknown as OxcNode, fb, source, ownerRef);
  } finally {
    fb.popScope();
  }
}

// ---------------------------------------------------------------------------
// Export emission
// ---------------------------------------------------------------------------

function emitExportNamed(node: ExportNamedDeclaration, fb: FileBuilder, source: string, emitState: EmitState): void {
  const decl = node.declaration;
  if (decl) {
    // `export const Foo = ...` / `export function Foo() {}` / `export class Foo {}`
    let symbolName: string | null = null;
    if (decl.type === "VariableDeclaration") {
      emitVariableDeclaration(decl as unknown as VariableDeclaration, fb, source, emitState);
      // Collect symbol names from declarators to mark as exported
      for (const d of (decl as unknown as VariableDeclaration).declarations as VariableDeclarator[]) {
        if (d.id.type === "Identifier") {
          const name = (d.id as unknown as { name: string }).name;
          // Re-emit with isExported: true (addDeclaration is upsert by key)
          emitDeclarationFromDeclarator(d, fb, source, { file: fb.filePath }, true);
          fb.addExport({ kind: "named", exportedAs: name, local: name });
        } else {
          fb.markUnrecordedExports();
        }
      }
      return;
    }
    if (
      decl.type === "FunctionDeclaration" ||
      decl.type === "TSDeclareFunction"
    ) {
      const fnNode = decl as unknown as OxcFunction;
      emitFunctionDeclaration(fnNode, fb, source);
      symbolName = fnNode.id?.name ?? null;
    } else if (
      decl.type === "ClassDeclaration" ||
      decl.type === "ClassExpression"
    ) {
      const classNode = decl as unknown as Class;
      emitClassDeclaration(classNode, fb, source);
      symbolName = classNode.id?.name ?? null;
    } else if (node.exportKind !== "type" && decl.type !== "TSInterfaceDeclaration" && decl.type !== "TSTypeAliasDeclaration") {
      // `export enum`, `export namespace`, `export import X = …`.
      fb.markUnrecordedExports();
    }
    if (symbolName) {
      // Re-emit declaration with isExported: true
      const loc = positionAt(source, (decl as unknown as { start: number }).start);
      if (decl.type === "FunctionDeclaration" || decl.type === "TSDeclareFunction") {
        const fnNode = decl as unknown as OxcFunction;
        const enclosingBinding = { file: fb.filePath };
        fb.addDeclaration({
          symbol: symbolName,
          value: {
            kind: "Function",
            returns: extractFunctionReturns(
              fnNode.body,
              fb.scopeForNode(fnScopeKey(fnNode.start), fb.currentScope()),
              fb.filePath,
              enclosingBinding,
              scopeForFnOf(fb),
              locAtOf(source),
              namespaceMembersOf(fb),
            ),
            enclosingBinding,
          },
          loc,
          isExported: true,
        });
      } else if (decl.type === "ClassDeclaration" || decl.type === "ClassExpression") {
        const classNode = decl as unknown as Class;
        const renderReturns = extractClassRenderReturns(classNode, fb.currentScope(), fb.filePath, scopeForFnOf(fb), locAtOf(source), namespaceMembersOf(fb));
        fb.addDeclaration({
          symbol: symbolName,
          value: {
            kind: "Function",
            returns: renderReturns ?? [{ kind: "Unknown" }],
          },
          loc,
          isExported: true,
        });
      }
      fb.addExport({ kind: "named", exportedAs: symbolName, local: symbolName });
    }
    return;
  }

  // `export { Foo }` or `export { Foo as Bar }` or `export { Foo as Bar } from "./x"`
  const from = node.source?.value ?? null;
  for (const spec of node.specifiers as ExportSpecifier[]) {
    const localName =
      spec.local.type === "Identifier"
        ? (spec.local as unknown as { name: string }).name
        : String((spec.local as unknown as { value: unknown }).value);
    const exportedName =
      spec.exported.type === "Identifier"
        ? (spec.exported as unknown as { name: string }).name
        : String((spec.exported as unknown as { value: unknown }).value);

    if (from) {
      fb.addExport({ kind: "named", exportedAs: exportedName, from, fromImported: localName });
    } else {
      fb.addExport({ kind: "named", exportedAs: exportedName, local: localName });
    }
  }
}

function emitExportDefault(node: ExportDefaultDeclaration, fb: FileBuilder, source: string): void {
  const decl = node.declaration;
  if (decl.type === "Identifier") {
    // `export default Foo`: re-export of a local binding.
    const local = (decl as unknown as { name: string }).name;
    fb.addExport({ kind: "default", local });
  } else if (
    decl.type === "FunctionDeclaration" ||
    decl.type === "TSDeclareFunction"
  ) {
    // `export default function App() { ... }`, named or anonymous.
    const fnNode = decl as unknown as OxcFunction;
    if (fnNode.id) {
      // Named: treat as a regular function declaration and record the default export.
      emitFunctionDeclaration(fnNode, fb, source);
      fb.addExport({ kind: "default", local: fnNode.id.name });
    } else {
      // Anonymous default export function: attribute JSX to the synthetic "default" symbol.
      const loc = positionAt(source, (node as unknown as { start: number }).start);
      const enclosingBinding = { file: fb.filePath };
      fb.addDeclaration({
        symbol: "default",
        value: {
          kind: "Function",
          returns: extractFunctionReturns(
            fnNode.body,
            fb.scopeForNode(fnScopeKey((fnNode as unknown as { start: number }).start), fb.currentScope()),
            fb.filePath,
            enclosingBinding,
            scopeForFnOf(fb),
            locAtOf(source),
            namespaceMembersOf(fb),
          ),
          enclosingBinding,
        },
        loc,
        isExported: true,
      });
      fb.addExport({ kind: "default", local: "default" });
      const ownerRef: Reference = { symbol: "default", scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
      if (fnNode.body) {
        const fnRef: Reference = { symbol: "default", scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
        fb.pushScope(fnScopeKey((fnNode as unknown as { start: number }).start));
        try {
          emitParameterBindings((fnNode as unknown as { params: OxcNode[] }).params, fnRef, fb, source);
          walkJsxIn(fnNode.body as unknown as OxcNode, fb, source, ownerRef);
          walkBodyCalls(fnNode.body as unknown as OxcNode, fb, source, "default");
        } finally {
          fb.popScope();
        }
      }
    }
  } else if (
    decl.type === "ClassDeclaration" ||
    decl.type === "ClassExpression"
  ) {
    // `export default class App { ... }`, named or anonymous.
    const classNode = decl as unknown as Class;
    if (classNode.id) {
      emitClassDeclaration(classNode, fb, source);
      fb.addExport({ kind: "default", local: classNode.id.name });
    } else {
      fb.markUnrecordedExports();
      fb.pushScope();
      try {
        walkJsxIn(classNode as unknown as OxcNode, fb, source, null);
      } finally {
        fb.popScope();
      }
    }
  } else if (decl.type === "CallExpression") {
    // `export default withFallback(InnerComponent)`: a HOC applied at the
    // default export site. As in the inline form (`const X = withFallback(Y)`
    // in emitVariableDeclaration above), synthesise a "default" declaration
    // whose value carries the ReturnTypeOf shape so the engine's wrapper-
    // folding collapses to the inner-arg identity.
    const loc = positionAt(source, (decl as unknown as { start: number }).start);
    fb.addDeclaration({
      symbol: "default",
      value: inferValue(
        decl as unknown as Parameters<typeof inferValue>[0],
        fb.currentScope(),
        fb.filePath,
        { file: fb.filePath },
        scopeForFnOf(fb),
        locAtOf(source),
        namespaceMembersOf(fb),
      ),
      loc,
      isExported: true,
    });
    fb.addExport({ kind: "default", local: "default" });
    // Walk JSX inside an anonymous inner arg (e.g. `withFallback(() => <Foo />)`)
    // with "default" as the owner so nested JSX is attributed correctly.
    const call = decl as unknown as { arguments: OxcNode[] };
    const firstArg = call.arguments[0];
    if (
      firstArg &&
      (firstArg.type === "ArrowFunctionExpression" || firstArg.type === "FunctionExpression")
    ) {
      const fnLike = firstArg as unknown as { params: OxcNode[]; body: OxcNode };
      const body = fnLike.body;
      const ownerRef: Reference = { symbol: "default", scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
      const fnRef: Reference = { symbol: "default", scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
      fb.pushScope(fnScopeKey((firstArg as unknown as { start: number }).start));
      try {
        emitParameterBindings(fnLike.params, fnRef, fb, source);
        walkJsxIn(body, fb, source, ownerRef, { parent: firstArg, key: "body", inPattern: false });
        walkBodyCalls(body, fb, source, "default");
      } finally {
        fb.popScope();
      }
      walkRemainingArguments(call, decl as unknown as OxcNode, fb, source);
    } else {
      // `export default memo(Composer)`: no function body to attribute; the
      // arguments are still read as values, so `Composer` is held.
      walkJsxIn(decl as unknown as OxcNode, fb, source, null, {
        parent: node as unknown as OxcNode,
        key: "declaration",
        inPattern: false,
      });
    }
  } else if (decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
    // `export default () => <Foo />`, the Next.js / Remix page shape.
    // Same treatment as the anonymous `export default function () {}` branch
    // above: synthesise a "default" declaration and attribute the body's JSX
    // and calls to it, binding the parameters first so a param-rooted
    // `<Component />` stays identity-less.
    const loc = positionAt(source, (decl as unknown as { start: number }).start);
    fb.addDeclaration({
      symbol: "default",
      value: inferValue(
        decl as unknown as Parameters<typeof inferValue>[0],
        fb.currentScope(),
        fb.filePath,
        { file: fb.filePath },
        scopeForFnOf(fb),
        locAtOf(source),
        namespaceMembersOf(fb),
      ),
      loc,
      isExported: true,
    });
    fb.addExport({ kind: "default", local: "default" });
    const fnLike = decl as unknown as { params: OxcNode[]; body: OxcNode };
    const ownerRef: Reference = { symbol: "default", scope: MODULE_SCOPE, memberChain: [], loc, originFile: fb.filePath };
    fb.pushScope(fnScopeKey((decl as unknown as { start: number }).start));
    try {
      emitParameterBindings(fnLike.params, ownerRef, fb, source);
      walkJsxIn(fnLike.body, fb, source, ownerRef, { parent: decl as unknown as OxcNode, key: "body", inPattern: false });
      walkBodyCalls(fnLike.body, fb, source, "default");
    } finally {
      fb.popScope();
    }
  } else {
    // Other default export shapes (`export default { Container, Grid }`, a
    // ternary, …) key no ownership, but they are still read as values: walk
    // them with no owner so what they name is held.
    fb.markUnrecordedExports();
    walkJsxIn(decl as unknown as OxcNode, fb, source, null, {
      parent: node as unknown as OxcNode,
      key: "declaration",
      inPattern: false,
    });
  }
}

function emitExportAll(node: ExportAllDeclaration, fb: FileBuilder): void {
  // Only a bare runtime `export *` is a star re-export. A namespace re-export
  // (`export * as Foo from`) is the one name `Foo`, recorded as a named
  // re-export of the module's namespace (`fromImported: "*"`). A type-only
  // re-export (`export type *`) carries no runtime symbols and is not recorded.
  if (node.exportKind === "type") return;
  const from = node.source.value;
  if (node.exported) {
    const exportedAs = node.exported.type === "Identifier" ? node.exported.name : node.exported.value;
    fb.addExport({ kind: "named", exportedAs, from, fromImported: "*" });
    return;
  }
  fb.addExport({ kind: "star", from });
}

/** A module-scope statement that exports without an ES export declaration:
 *  `export = …`, or a CommonJS `module.exports = …`, `module.exports.x = …`
 *  or `exports.x = …`. */
function isUnrecordedExport(node: OxcNode): boolean {
  if (node.type === "TSExportAssignment") return true;
  if (node.type !== "ExpressionStatement") return false;
  const expr = (node as unknown as { expression: OxcNode }).expression;
  if (expr.type !== "AssignmentExpression") return false;
  let target = (expr as unknown as { left: OxcNode }).left;
  while (isStaticMember(target)) {
    const { object, property } = target as unknown as StaticMemberExpression;
    if (object.type === "Identifier" && ((object.name === "module" && property.name === "exports") || object.name === "exports")) {
      return true;
    }
    target = object as unknown as OxcNode;
  }
  return false;
}
