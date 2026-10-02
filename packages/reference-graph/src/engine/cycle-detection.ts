/** Max barrel-walk depth, matches LazyResolver's MAX_REEXPORT_HOPS budget. */
export const MAX_REFERENCE_DEPTH = 32;

export type CycleGuard = {
  visited: Set<string>;
  depth: number;
  /** Cheap key: file + symbol identity for cycle detection. */
  push(file: string, symbol: string): "ok" | "cycle" | "too-deep";
  pop(file: string, symbol: string): void;
  /**
   * Structural cycle guard for the resolveType / resolveToFunctions walk.
   * Tracks InferredType nodes on the current resolution path by object
   * identity. Legal JS can produce cyclic value graphs (`function f() {
   * return { f }; }`, destructured IIFEs whose return object references the
   * destructure target). Any infinite walk must revisit a shared parser-built
   * node, so a path-scoped identity set guarantees termination. String keys
   * (file::symbol) can't be used here: shadowed bindings share a symbol and
   * would be false-cut.
   */
  pushNode(node: object): "ok" | "cycle";
  popNode(node: object): void;
};

export function createCycleGuard(): CycleGuard {
  const visited = new Set<string>();
  const nodesOnPath = new Set<object>();
  let depth = 0;
  return {
    visited,
    get depth() { return depth; },
    push(file, symbol) {
      const key = `${file}::${symbol}`;
      if (visited.has(key)) return "cycle";
      if (depth >= MAX_REFERENCE_DEPTH) return "too-deep";
      visited.add(key);
      depth++;
      return "ok";
    },
    pop(file, symbol) {
      visited.delete(`${file}::${symbol}`);
      depth--;
    },
    pushNode(node) {
      if (nodesOnPath.has(node)) return "cycle";
      nodesOnPath.add(node);
      return "ok";
    },
    popNode(node) {
      nodesOnPath.delete(node);
    },
  };
}
