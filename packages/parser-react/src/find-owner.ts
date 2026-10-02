/**
 * Walk an oxc/ESTree program from `program` down to `target`, returning the
 * nearest enclosing component binding.
 *
 * A "component binding" is a function or class declaration / variable
 * declarator whose binding name is PascalCase, or an anonymous `export default`.
 *
 * HOC wrappers (`memo`, `forwardRef`, `observer`, `React.memo`, `React.forwardRef`)
 * are unwrapped: the binding name comes from the enclosing variable declarator,
 * not the call expression.
 *
 * Returns `null` when no enclosing tracked component is found before reaching
 * module scope (e.g. JSX at module top-level).
 *
 * Algorithm: walk top-down through `program`, maintaining two parallel stacks
 * of currently-entered nodes: `pathStack` (every node) and `frameStack` (just
 * the candidate owners: Function/Arrow/Class declarations or expressions).
 * When the `target` node is entered, scan `frameStack` from innermost outward
 * and return the first frame whose contextual binding satisfies the rules:
 * PascalCase id, predicate (if any), default-export special case, HOC
 * unwrapping. Pop both stacks in `leave`.
 *
 * `loc` is always `null`, since oxc-parser emits byte offsets only
 * (`positionAt` in `./position.ts` converts one).
 */
import type {
  Class,
  Function as OxcFunction,
  Node as OxcNode,
  Program,
} from "@oxc-project/types";
import { walk } from "oxc-walker";

export type EnclosingComponentBinding = {
  /** Binding name; `"default"` for anonymous default exports. */
  name: string;
  /** True for `export default ...` cases. */
  isDefault: boolean;
  /** Declaration site: always null (oxc-parser emits byte offsets only). */
  loc: { line: number; column: number } | null;
};

/**
 * Optional predicate supplied by the caller. When provided, a candidate
 * binding is only returned if `isKnownComponent(name)` returns true; otherwise
 * the walk continues upward. When omitted, any PascalCase binding (or
 * anonymous `export default`) is accepted.
 */
export type IsKnownComponent = (name: string) => boolean;

const HOC_NAMES = new Set(["memo", "forwardRef", "observer"]);

type OxcParent = OxcNode | null;

/**
 * Walk an oxc/ESTree program from `program` down to `target`, returning the
 * nearest enclosing component binding. The `target` must be a node within
 * `program`. Reference equality is used to detect arrival.
 */
export function findEnclosingComponentBinding(
  target: OxcNode,
  program: Program,
  isKnownComponent?: IsKnownComponent,
): EnclosingComponentBinding | null {
  const pathStack: OxcNode[] = [];
  // Frames hold the candidate node plus the pathStack depth at which it was
  // pushed, so binding-evaluation can look up parents/grandparents at scan
  // time without re-discovering them.
  const frameStack: { node: OxcNode; depth: number }[] = [];
  let result: EnclosingComponentBinding | null = null;
  let done = false;

  walk(program, {
    enter(node) {
      if (done) {
        (this as { skip?: () => void }).skip?.();
        return;
      }
      pathStack.push(node);

      // Arrival is checked before the target's own frame is pushed, so a
      // candidate-shaped target (e.g. an ArrowFunctionExpression passed in
      // by a caller) is not considered its own owner.
      if (node === target) {
        result = scanFrameStack(frameStack, pathStack, isKnownComponent);
        done = true;
        (this as { skip?: () => void }).skip?.();
        return;
      }

      if (isOwnerCandidateNode(node)) {
        frameStack.push({ node, depth: pathStack.length - 1 });
      }
    },
    leave(node) {
      // Pop frameStack first (it is a subset of pathStack frames).
      const top = frameStack[frameStack.length - 1];
      if (top && top.node === node) frameStack.pop();
      pathStack.pop();
    },
  });

  return result;
}

function isOwnerCandidateNode(node: OxcNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  );
}

function scanFrameStack(
  frameStack: { node: OxcNode; depth: number }[],
  pathStack: OxcNode[],
  isKnownComponent: IsKnownComponent | undefined,
): EnclosingComponentBinding | null {
  for (let i = frameStack.length - 1; i >= 0; i--) {
    const frame = frameStack[i];
    if (!frame) continue;
    const parent: OxcParent = pathStack[frame.depth - 1] ?? null;
    const grand: OxcParent = pathStack[frame.depth - 2] ?? null;
    const binding = bindingForOxcFrame(frame.node, parent, grand, isKnownComponent);
    if (binding) return binding;
  }
  return null;
}

function bindingForOxcFrame(
  node: OxcNode,
  parent: OxcParent,
  grand: OxcParent,
  isKnownComponent: IsKnownComponent | undefined,
): EnclosingComponentBinding | null {
  // class Name { … } / class Name extends Base { … }
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    const cls = node as Class;
    const id = cls.id;
    if (id && isPascalCase(id.name)) {
      if (!isKnownComponent || isKnownComponent(id.name)) {
        return { name: id.name, isDefault: false, loc: null };
      }
    }
    if (parent?.type === "ExportDefaultDeclaration") {
      if (!isKnownComponent || isKnownComponent("default")) {
        return { name: "default", isDefault: true, loc: null };
      }
    }
    return null;
  }

  // function Name() { … }
  if (node.type === "FunctionDeclaration") {
    const fn = node as OxcFunction;
    const id = fn.id;
    if (parent?.type === "ExportDefaultDeclaration") {
      const name = id && isPascalCase(id.name) ? id.name : "default";
      if (!isKnownComponent || isKnownComponent(name)) {
        return { name, isDefault: true, loc: null };
      }
    }
    if (id && isPascalCase(id.name)) {
      if (!isKnownComponent || isKnownComponent(id.name)) {
        return { name: id.name, isDefault: false, loc: null };
      }
    }
    return null;
  }

  // (...) => …  /  function () { … }  (anonymous), examined by its context.
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    return bindingFromAnonymousFunctionParent(parent, grand, isKnownComponent);
  }

  return null;
}

function bindingFromAnonymousFunctionParent(
  parent: OxcParent,
  grand: OxcParent,
  isKnownComponent: IsKnownComponent | undefined,
): EnclosingComponentBinding | null {
  if (!parent) return null;

  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return bindingFromVariableId(parent.id.name, isKnownComponent);
  }

  if (parent.type === "CallExpression" && isHocCall(parent)) {
    if (!grand) return null;
    if (grand.type === "VariableDeclarator" && grand.id.type === "Identifier") {
      return bindingFromVariableId(grand.id.name, isKnownComponent);
    }
    if (grand.type === "ExportDefaultDeclaration") {
      if (!isKnownComponent || isKnownComponent("default")) {
        return { name: "default", isDefault: true, loc: null };
      }
    }
    return null;
  }

  if (parent.type === "ExportDefaultDeclaration") {
    if (!isKnownComponent || isKnownComponent("default")) {
      return { name: "default", isDefault: true, loc: null };
    }
  }

  return null;
}

function bindingFromVariableId(
  name: string,
  isKnownComponent: IsKnownComponent | undefined,
): EnclosingComponentBinding | null {
  if (!isPascalCase(name)) return null;
  if (isKnownComponent && !isKnownComponent(name)) return null;
  return { name, isDefault: false, loc: null };
}

function isHocCall(call: OxcNode): boolean {
  if (call.type !== "CallExpression") return false;
  const callee = call.callee;
  if (callee.type === "Identifier") return HOC_NAMES.has(callee.name);
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "React" &&
    callee.property.type === "Identifier"
  ) {
    return HOC_NAMES.has(callee.property.name);
  }
  return false;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}
