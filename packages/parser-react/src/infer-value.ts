/**
 * Convert oxc Expression AST nodes into InferredType algebra values.
 *
 * Purely structural: it pattern-matches AST shapes and converts them into the
 * reference-graph InferredType algebra. No resolution happens here; the engine
 * assigns meaning after the walk.
 */

import type {
  ArrowFunctionExpression,
  ArrayExpression,
  CallExpression,
  Class,
  ConditionalExpression,
  Expression,
  Function as OxcFunction,
  LogicalExpression,
  ObjectExpression,
  ObjectProperty,
  ReturnStatement,
  Statement,
} from "@oxc-project/types";
import type { InferredType } from "@scoutui/reference-graph";
import { DYNAMIC_MEMBER_KEY } from "@scoutui/reference-graph";
import type { ScopeId } from "@scoutui/reference-graph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyNode = { type: string; [key: string]: unknown };

/**
 * Get-or-create the scope id for a nested function body, keyed by the
 * function node's span start. Backed by `FileBuilder.scopeForNode`, so refs
 * stamped during value inference agree with the scope the declaration walk
 * pushes for the same function (`fn@<start>`). When absent (tests, callers
 * without a builder), inference falls back to the enclosing scope.
 */
export type ScopeForFn = (fnStart: number, parent: ScopeId) => ScopeId;

/**
 * Offset → position for the file being inferred. Backed by `positionAt` in
 * emit.ts. Every `TypeOf` built from an identifier records that identifier's
 * own position so a value reference can locate an occurrence (argument-site
 * seeding). When absent (tests, callers without source) the
 * reference is stamped 0:0.
 */
export type LocAt = (offset: number) => { line: number; column: number };

/**
 * The static member chains (`NS.a.b`) whose root names a namespace import
 * where it is read, by their outermost member-expression node. Backed by
 * `namespaceMemberChains` in emit.ts. `inferValue` lowers each to a reference
 * to the namespace carrying the chain, the shape a JSX member tag has.
 */
export type NamespaceMembers = ReadonlySet<object>;

/** Strip TypeScript noise wrappers so the underlying expression is visible. */
export function unwrapTsNoise(node: Expression | null | undefined): Expression | null | undefined {
  let current: Expression | null | undefined = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "ParenthesizedExpression")
  ) {
    current = (current as unknown as { expression: Expression }).expression;
  }
  return current;
}

/**
 * Walk a function body (BlockStatement or concise arrow expression) and
 * collect all InferredType values that appear in return positions.
 *
 * For concise arrows (`() => <div />`), the entire body is the return value.
 * For block bodies, we collect return statement arguments.
 */
export function extractFunctionReturns(
  body: Expression | { type: "BlockStatement"; body: Statement[] } | null | undefined,
  scope: ScopeId,
  originFile: string,
  enclosingBinding?: { file: string },
  scopeForFn?: ScopeForFn,
  locAt?: LocAt,
  namespaceMembers?: NamespaceMembers,
): InferredType[] {
  if (!body) return [{ kind: "Unknown" }];

  // Concise arrow: body is an expression (the return value).
  if (body.type !== "BlockStatement") {
    const unwrapped = unwrapTsNoise(body as Expression);
    return [inferValue(unwrapped ?? null, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers)];
  }

  // Block statement: collect all return statement arguments.
  const stmts = (body as { type: "BlockStatement"; body: Statement[] }).body;
  const returns: InferredType[] = [];
  collectReturnsFromStatements(stmts, scope, returns, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
  return returns.length > 0 ? returns : [{ kind: "Unknown" }];
}

/**
 * Recursively collect return values from a statement list, descending into
 * BlockStatement, IfStatement consequent/alternate, TryStatement blocks and
 * SwitchCase bodies. Other statements (loops, labels) are not entered.
 */
function collectReturnsFromStatements(
  stmts: Statement[],
  scope: ScopeId,
  out: InferredType[],
  originFile: string,
  enclosingBinding?: { file: string },
  scopeForFn?: ScopeForFn,
  locAt?: LocAt,
  namespaceMembers?: NamespaceMembers,
): void {
  for (const stmt of stmts) {
    if (stmt.type === "ReturnStatement") {
      const rs = stmt as ReturnStatement;
      const unwrapped = unwrapTsNoise(rs.argument ?? null);
      out.push(inferValue(unwrapped ?? null, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers));
    } else if (stmt.type === "BlockStatement") {
      collectReturnsFromStatements(
        (stmt as { type: "BlockStatement"; body: Statement[] }).body,
        scope,
        out,
        originFile,
        enclosingBinding,
        scopeForFn, locAt, namespaceMembers,
      );
    } else if (stmt.type === "IfStatement") {
      const ifStmt = stmt as unknown as {
        consequent: Statement;
        alternate: Statement | null;
      };
      collectReturnsFromStatements([ifStmt.consequent], scope, out, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      if (ifStmt.alternate) {
        collectReturnsFromStatements([ifStmt.alternate], scope, out, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      }
    } else if (stmt.type === "TryStatement") {
      const tryStmt = stmt as unknown as {
        block: { body: Statement[] };
        handler: { body: { body: Statement[] } } | null;
        finalizer: { body: Statement[] } | null;
      };
      collectReturnsFromStatements(tryStmt.block.body, scope, out, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      if (tryStmt.handler) {
        collectReturnsFromStatements(tryStmt.handler.body.body, scope, out, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      }
      if (tryStmt.finalizer) {
        collectReturnsFromStatements(tryStmt.finalizer.body, scope, out, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      }
    } else if (stmt.type === "SwitchStatement") {
      const sw = stmt as unknown as { cases: Array<{ consequent: Statement[] }> };
      for (const c of sw.cases) {
        collectReturnsFromStatements(c.consequent, scope, out, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      }
    }
  }
}

/**
 * Walk a class body looking for `render()` and return the InferredType
 * values from its return statements.
 *
 * Returns null if no `render` method is found (callers fall back to
 * `[{ kind: "Unknown" }]`).
 */
export function extractClassRenderReturns(
  node: Class,
  scope: ScopeId,
  originFile: string,
  scopeForFn?: ScopeForFn,
  locAt?: LocAt,
  namespaceMembers?: NamespaceMembers,
): InferredType[] | null {
  const body = node.body.body;
  for (const member of body) {
    if (member.type !== "MethodDefinition") continue;
    const key = (member as unknown as { key: AnyNode }).key;
    if (key.type !== "Identifier" || (key as unknown as { name: string }).name !== "render") continue;
    const fn = (member as unknown as { value: OxcFunction }).value;
    const bodyScope = scopeForFn ? scopeForFn((fn as unknown as { start: number }).start, scope) : scope;
    return extractFunctionReturns(fn.body, bodyScope, originFile, undefined, scopeForFn, locAt, namespaceMembers);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core inference
// ---------------------------------------------------------------------------

/**
 * A name, or a static member chain rooted at a name (`NS.a.b`), as `TypeOf(NS)`
 * with member chain `["a", "b"]`. Null for any other expression.
 */
export function memberChainRef(
  node: Expression,
  scope: ScopeId,
  originFile: string,
  locAt?: LocAt,
): Extract<InferredType, { kind: "TypeOf" }> | null {
  const memberChain: string[] = [];
  let cur = node as unknown as { type: string; computed?: boolean; object: unknown; property: { type: string; name: string } };
  while (cur.type === "MemberExpression" && !cur.computed && cur.property.type === "Identifier") {
    memberChain.unshift(cur.property.name);
    cur = cur.object as typeof cur;
  }
  if (cur.type !== "Identifier") return null;
  const root = cur as unknown as { name: string; start: number };
  return {
    kind: "TypeOf",
    ref: { symbol: root.name, scope, memberChain, loc: locAt ? locAt(root.start) : { line: 0, column: 0 }, originFile },
  };
}

/**
 * Convert an oxc Expression node into an InferredType value. TS noise is
 * unwrapped here, so callers can pass raw AST nodes.
 */
export function inferValue(
  expr: Expression | null | undefined,
  scope: ScopeId,
  originFile: string,
  enclosingBinding?: { file: string },
  scopeForFn?: ScopeForFn,
  locAt?: LocAt,
  namespaceMembers?: NamespaceMembers,
): InferredType {
  const node = unwrapTsNoise(expr);
  if (!node) return { kind: "Unknown" };

  switch (node.type) {
    // ------------------------------------------------------------------
    // Identifier → TypeOf(ref)
    // ------------------------------------------------------------------
    case "Identifier": {
      const id = node as unknown as { name: string; start: number };
      return {
        kind: "TypeOf",
        ref: {
          symbol: id.name,
          scope,
          memberChain: [],
          loc: locAt ? locAt(id.start) : { line: 0, column: 0 },
          originFile,
        },
      };
    }

    // ------------------------------------------------------------------
    // String literal → Str
    // ------------------------------------------------------------------
    case "Literal": {
      const lit = node as unknown as { value: unknown };
      if (typeof lit.value === "string") {
        return { kind: "Str", value: lit.value };
      }
      return { kind: "Unknown" };
    }

    // ------------------------------------------------------------------
    // JSX → JSX
    // ------------------------------------------------------------------
    case "JSXElement":
    case "JSXFragment":
      return { kind: "JSX" };

    // ------------------------------------------------------------------
    // Arrow function → Function([returns])
    // ------------------------------------------------------------------
    case "ArrowFunctionExpression": {
      const arrow = node as unknown as ArrowFunctionExpression;
      // Refs inside the body live in the function's own scope, not the
      // enclosing statement's; otherwise body-local shadows resolve to the
      // outer binding (and a destructured IIFE closes a reference cycle).
      const bodyScope = scopeForFn ? scopeForFn(arrow.start, scope) : scope;
      return {
        kind: "Function",
        returns: extractFunctionReturns(arrow.body, bodyScope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers),
        ...(enclosingBinding ? { enclosingBinding } : {}),
      };
    }

    // ------------------------------------------------------------------
    // Function expression → Function([returns])
    // ------------------------------------------------------------------
    case "FunctionExpression": {
      const fn = node as unknown as OxcFunction;
      const bodyScope = scopeForFn ? scopeForFn(fn.start, scope) : scope;
      return {
        kind: "Function",
        returns: extractFunctionReturns(fn.body, bodyScope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers),
        ...(enclosingBinding ? { enclosingBinding } : {}),
      };
    }

    // ------------------------------------------------------------------
    // Call expression → ReturnTypeOf(callee, args)
    // (or DynamicImport when the call is an import() promise chain)
    // ------------------------------------------------------------------
    case "CallExpression": {
      const call = node as unknown as CallExpression;

      const collapsed = collapseImportChain(call, originFile);
      if (collapsed) return collapsed;

      const callee = inferValue(call.callee as Expression, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      const args = call.arguments.map((arg) => {
        if (arg.type === "SpreadElement") {
          return inferValue(
            (arg as unknown as { argument: Expression }).argument,
            scope,
            originFile,
            enclosingBinding,
            scopeForFn, locAt, namespaceMembers,
          );
        }
        return inferValue(arg as Expression, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      });
      return { kind: "ReturnTypeOf", callee, args };
    }

    // ------------------------------------------------------------------
    // Member expression → MemberOf(obj, member)
    // ------------------------------------------------------------------
    case "MemberExpression": {
      const mem = node as unknown as {
        object: Expression;
        property: Expression;
        computed: boolean;
      };
      if (namespaceMembers?.has(node)) {
        const ref = memberChainRef(node, scope, originFile, locAt);
        if (ref !== null) return ref;
      }
      const obj = inferValue(mem.object, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      // Static access: obj.foo → member = "foo"
      // Dynamic access: obj[k]  → DYNAMIC_MEMBER_KEY unless k is a string literal
      if (!mem.computed) {
        // StaticMemberExpression: property is always IdentifierName
        const propName = (mem.property as unknown as { name: string }).name;
        return { kind: "MemberOf", obj, member: propName };
      }
      // ComputedMemberExpression
      const propNode = unwrapTsNoise(mem.property);
      if (propNode?.type === "Literal" && typeof (propNode as unknown as { value: unknown }).value === "string") {
        return { kind: "MemberOf", obj, member: (propNode as unknown as { value: string }).value };
      }
      return { kind: "MemberOf", obj, member: DYNAMIC_MEMBER_KEY };
    }

    // ------------------------------------------------------------------
    // Object expression → Object({ key: inferValue(val) })
    // ------------------------------------------------------------------
    case "ObjectExpression": {
      const objExpr = node as unknown as ObjectExpression;
      const props: Record<string, InferredType> = {};
      let open = false;
      for (const propKind of objExpr.properties) {
        if (propKind.type !== "Property") {
          // SpreadElement: its keys are unknown, so the object is open.
          open = true;
          continue;
        }
        const prop = propKind as unknown as ObjectProperty;
        const key = prop.key;
        let keyStr: string | null = null;

        // A computed key (`{ [STATUS.ACCEPTED]: X }`, `{ [KEY]: X }`) names
        // nothing statically, so the value belongs in the dynamic slot, not
        // under whatever the key expression happens to spell.
        if (!prop.computed) {
          if (key.type === "Identifier") {
            keyStr = (key as unknown as { name: string }).name;
          } else if (key.type === "Literal") {
            const v = (key as unknown as { value: unknown }).value;
            if (typeof v === "string") keyStr = v;
          }
          if (keyStr === null) continue;
        } else if (key.type === "Literal" && typeof (key as unknown as { value: unknown }).value === "string") {
          // `{ ["foo"]: X }`: computed spelling of a static name.
          keyStr = (key as unknown as { value: string }).value;
        }

        let valExpr: Expression;
        if (prop.shorthand) {
          // `{ Foo }`: the key is the value identifier.
          valExpr = prop.key as unknown as Expression;
        } else {
          valExpr = prop.value;
        }
        const value = inferValue(valExpr, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
        if (keyStr !== null) {
          props[keyStr] = value;
          continue;
        }
        // Every computed key shares the one dynamic slot that a dynamic access
        // (`MemberOf` with DYNAMIC_MEMBER_KEY) already reads, so they
        // accumulate as a Union (the slot holds any of them) instead of the
        // last one winning.
        open = true;
        const held = props[DYNAMIC_MEMBER_KEY];
        props[DYNAMIC_MEMBER_KEY] =
          held === undefined
            ? value
            : { kind: "Union", types: held.kind === "Union" ? [...held.types, value] : [held, value] };
      }
      return open ? { kind: "Object", props, openMembers: true } : { kind: "Object", props };
    }

    // ------------------------------------------------------------------
    // Array expression → Array([elements])
    // ------------------------------------------------------------------
    case "ArrayExpression": {
      const arrExpr = node as unknown as ArrayExpression;
      const elements: InferredType[] = arrExpr.elements.map((el) => {
        if (el === null) return { kind: "Unknown" };
        if (el.type === "SpreadElement") {
          return inferValue(
            (el as unknown as { argument: Expression }).argument,
            scope,
            originFile,
            enclosingBinding,
            scopeForFn, locAt, namespaceMembers,
          );
        }
        return inferValue(el as Expression, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers);
      });
      return { kind: "Array", elements };
    }

    // ------------------------------------------------------------------
    // Dynamic import → DynamicImport(specifier, [])
    // Projection is added by callers that recognise `.then(...)` chains and
    // async-await unwrap patterns (see CallExpression case below).
    // ------------------------------------------------------------------
    case "ImportExpression": {
      const imp = node as unknown as { source: Expression };
      const src = unwrapTsNoise(imp.source);
      if (src?.type === "Literal" && typeof (src as unknown as { value: unknown }).value === "string") {
        return {
          kind: "DynamicImport",
          specifier: (src as unknown as { value: string }).value,
          projection: [],
          originFile,
        };
      }
      return { kind: "Unknown" };
    }

    // ------------------------------------------------------------------
    // Await expression: `await import('x')` → DynamicImport(x, [])
    // Other await-arg shapes fall through to Unknown.
    // ------------------------------------------------------------------
    case "AwaitExpression": {
      const aw = node as unknown as { argument: Expression };
      const arg = unwrapTsNoise(aw.argument);
      if (arg?.type === "ImportExpression") {
        return inferValue(arg, scope, originFile);
      }
      return { kind: "Unknown" };
    }

    // ------------------------------------------------------------------
    // Conditional / logical → Union of the branches. `a ? <A/> : <B/>`,
    // `a && <A/>`, `a ?? <B/>`. Both operands are inferred so the engine's
    // Union fan-out sees every branch; a non-JSX branch (null, a string)
    // stays in the union as whatever it infers to. Without this arm, a
    // component whose render is a conditional would lower to
    // Function([Unknown]), like a render-less class, and the component-shape
    // predicate could not admit it.
    // ------------------------------------------------------------------
    case "ConditionalExpression": {
      const cond = node as unknown as ConditionalExpression;
      return {
        kind: "Union",
        types: [
          inferValue(unwrapTsNoise(cond.consequent) ?? null, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers),
          inferValue(unwrapTsNoise(cond.alternate) ?? null, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers),
        ],
      };
    }
    case "LogicalExpression": {
      const logical = node as unknown as LogicalExpression;
      return {
        kind: "Union",
        types: [
          inferValue(unwrapTsNoise(logical.left) ?? null, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers),
          inferValue(unwrapTsNoise(logical.right) ?? null, scope, originFile, enclosingBinding, scopeForFn, locAt, namespaceMembers),
        ],
      };
    }

    // ------------------------------------------------------------------
    // Default: Unknown for unrecognised shapes
    // ------------------------------------------------------------------
    default:
      return { kind: "Unknown" };
  }
}

// ---------------------------------------------------------------------------
// import() promise-chain helpers
// ---------------------------------------------------------------------------

const PROMISE_PASSTHROUGH = new Set(["catch", "finally"]);

/**
 * Collapse `import("x")` with any chain of `.then(thunk)`, `.catch(h)` and
 * `.finally(h)` around it into one DynamicImport. `.catch`/`.finally` leave
 * the resolved value untouched, and so does a `.then` whose thunk hands the
 * module straight back (`m => m`): it claims no projection and leaves the
 * slot free. One other `.then` may project a named export (`m => m.X`,
 * `({ X }) => X`, `m => ({ default: m.X })`). Anything else returns null and
 * the call lowers to a generic ReturnTypeOf.
 */
function collapseImportChain(call: CallExpression, originFile: string): InferredType | null {
  let projection: string[] | null = null;
  let node: Expression | null | undefined = call as unknown as Expression;
  for (;;) {
    const cur = unwrapTsNoise(node) as unknown as AnyNode | null;
    if (!cur) return null;
    if (cur.type === "ImportExpression") {
      const src = unwrapTsNoise((cur as unknown as { source: Expression }).source);
      if (!src || src.type !== "Literal") return null;
      const value = (src as unknown as { value: unknown }).value;
      if (typeof value !== "string") return null;
      return { kind: "DynamicImport", specifier: value, projection: projection ?? [], originFile };
    }
    if (cur.type !== "CallExpression") return null;
    const c = cur as unknown as CallExpression;
    const callee = unwrapTsNoise(c.callee as Expression);
    if (!callee || callee.type !== "MemberExpression") return null;
    const mem = callee as unknown as { object: Expression; property: AnyNode; computed: boolean };
    if (mem.computed || mem.property.type !== "Identifier") return null;
    const method = (mem.property as unknown as { name: string }).name;
    if (PROMISE_PASSTHROUGH.has(method)) {
      node = mem.object;
      continue;
    }
    if (method !== "then" || c.arguments.length !== 1) return null;
    const thunk = unwrapTsNoise(c.arguments[0] as unknown as Expression);
    if (!thunk) return null;
    if (isIdentityThunk(thunk as unknown as AnyNode)) {
      node = mem.object;
      continue;
    }
    if (projection !== null) return null;
    projection = extractThenProjection(thunk as unknown as AnyNode);
    if (projection === null) return null;
    node = mem.object;
  }
}

/** `m => m`: one identifier parameter handed straight back as the body. */
function isIdentityThunk(thunk: AnyNode): boolean {
  if (thunk.type !== "ArrowFunctionExpression" && thunk.type !== "FunctionExpression") return false;
  const fn = thunk as unknown as { params: AnyNode[]; body: AnyNode };
  if (fn.params.length !== 1) return false;
  const param = fn.params[0];
  if (!param || param.type !== "Identifier") return false;
  const body = (unwrapTsNoise(fn.body as unknown as Expression) as unknown as AnyNode) ?? fn.body;
  return (
    body.type === "Identifier" &&
    (body as unknown as { name: string }).name === (param as unknown as { name: string }).name
  );
}

/**
 * Extract the projection from a .then thunk. The projection names the export
 * to look up in the target module, so the named-export adapter yields the
 * export it reads rather than the key it writes.
 *
 *   - `m => m.X`                 →  ["X"]
 *   - `({X}) => X`               →  ["X"]
 *   - `m => ({ default: m.X })`  →  ["X"]
 *   - Anything else              →  null (caller falls through)
 */
function extractThenProjection(thunk: AnyNode): string[] | null {
  if (thunk.type !== "ArrowFunctionExpression" && thunk.type !== "FunctionExpression") return null;
  const fn = thunk as unknown as { params: AnyNode[]; body: AnyNode };
  if (fn.params.length !== 1) return null;
  const param: AnyNode | undefined = fn.params[0];
  if (!param) return null;
  const body = (unwrapTsNoise(fn.body as unknown as Expression) as unknown as AnyNode) ?? fn.body;

  // Shape 1: m => m.X, and the adapter m => ({ default: m.X })
  if (param.type === "Identifier") {
    const paramName = (param as unknown as { name: string }).name;
    /** `m.X` → "X", for this thunk's own parameter only. */
    const readMember = (n: AnyNode): string | null => {
      if (n.type !== "MemberExpression") return null;
      const memBody = n as unknown as { object: AnyNode; property: AnyNode; computed: boolean };
      if (
        memBody.computed ||
        memBody.object.type !== "Identifier" ||
        (memBody.object as unknown as { name: string }).name !== paramName ||
        memBody.property.type !== "Identifier"
      ) {
        return null;
      }
      return (memBody.property as unknown as { name: string }).name;
    };

    const direct = readMember(body);
    if (direct !== null) return [direct];

    if (body.type === "ObjectExpression") {
      const props = (body as unknown as { properties: AnyNode[] }).properties;
      if (props.length !== 1) return null;
      const only = props[0];
      if (!only || only.type !== "Property") return null;
      const p = only as unknown as { key: AnyNode; value: AnyNode; computed: boolean; shorthand: boolean };
      if (p.computed || p.shorthand) return null;
      if (p.key.type !== "Identifier" || (p.key as unknown as { name: string }).name !== "default") return null;
      const adapted = readMember(p.value);
      return adapted === null ? null : [adapted];
    }
    return null;
  }

  // Shape 2: ({X}) => X
  if (param.type === "ObjectPattern") {
    const props = (param as unknown as { properties: AnyNode[] }).properties;
    if (props.length !== 1) return null;
    const p = props[0] as unknown as { key: AnyNode; value: AnyNode; shorthand: boolean };
    if (!p.shorthand) return null;
    const keyName = (p.key as unknown as { name: string }).name;
    if (body.type === "Identifier" && (body as unknown as { name: string }).name === keyName) {
      return [keyName];
    }
    return null;
  }

  return null;
}
