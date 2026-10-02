import type { Reference } from "./reference.js";

/**
 * Typed value-flow algebra. Every binding's value is described by an
 * InferredType expression. The resolution engine walks these expressions
 * across module boundaries, threading concrete component identities
 * through arbitrary call chains.
 */
export type InferredType =
  | { kind: "TypeOf"; ref: Reference }
  | {
      kind: "Function";
      returns: InferredType[];
      /**
       * The file of the source binding this `Function` was emitted inside,
       * when known. Set by the parser at emit time (e.g.
       * `const X = forwardRef(...)` tags the inner arrow with
       * `{ file: <source file> }`). Lets the engine walk the function in the
       * file that wrote it even after walking across file boundaries,
       * without threading per-file context through every recursive call.
       */
      enclosingBinding?: { file: string };
      /**
       * Set when the function object can carry members the graph does not
       * record, such as a Vue SFC whose script declares its options: a
       * member missing from it is not provably absent.
       */
      openMembers?: true;
    }
  | { kind: "ReturnTypeOf"; callee: InferredType; args: InferredType[] }
  | { kind: "ParameterOf"; fn: Reference; index: number }
  | { kind: "MemberOf"; obj: InferredType; member: string }
  | { kind: "Union"; types: InferredType[] }
  | {
      kind: "Object";
      props: Record<string, InferredType>;
      /** Set when the literal has keys `props` cannot name (a spread, a
       *  computed key): a member missing from it is not provably absent. */
      openMembers?: true;
    }
  | { kind: "Array"; elements: InferredType[] }
  | { kind: "JSX" }
  | { kind: "Str"; value: string }
  | { kind: "Unknown" }
  | { kind: "DynamicImport"; specifier: string; projection: string[]; originFile: string };
