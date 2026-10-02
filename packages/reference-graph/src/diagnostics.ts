/**
 * Diagnostics the engine reports, a discriminated union by `code`. The CLI
 * adds its own codes to this union and collects both with
 * `createDiagnosticCollector`.
 */
export type EngineDiagnostic =
  | {
      code: "lazy-import-unsupported";
      severity: "warning";
      filePath: string;
      line: number;
      column: number;
      specifier: string;
      detail: string;
    }
  | {
      code: "unresolved-reference";
      severity: "info";
      filePath: string;
      line: number;
      column: number;
      symbol: string;
      memberChain: string[];
    }
  | {
      code: "late-bound-render";
      severity: "info";
      filePath: string;
      line: number;
      column: number;
      symbol: string;
      memberChain: string[];
    };

export interface DiagnosticCollector<D extends { code: string } = EngineDiagnostic> {
  emit(d: D): void;
  drain(): D[];
}

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled diagnostic code: ${(x as { code: string }).code}`);
}

/**
 * A stable dedup key for an engine diagnostic. Two diagnostics with identical
 * keys are treated as the same observation and only emitted once.
 *
 * Keys are constructed per-code from the fields that identify the observation
 * (e.g. file + line), not the severity or descriptive `detail` fields.
 */
export function engineDiagnosticKey(d: EngineDiagnostic): string {
  switch (d.code) {
    case "lazy-import-unsupported":
      return `${d.code}::${d.filePath}::${d.line}::${d.column}::${d.specifier}`;
    case "unresolved-reference":
      return `${d.code}::${d.filePath}::${d.line}::${d.column}::${d.symbol}::${d.memberChain.join(".")}`;
    case "late-bound-render":
      return `${d.code}::${d.filePath}::${d.line}::${d.column}::${d.symbol}::${d.memberChain.join(".")}`;
    default:
      return assertUnreachable(d);
  }
}

/**
 * Collects diagnostics in emit order, keeping only the first of any with the
 * same key. `keyOf` defaults to `engineDiagnosticKey`; a caller with more codes
 * passes a key function covering all of them. `drain` returns what was
 * collected and starts over.
 */
export function createDiagnosticCollector(): DiagnosticCollector;
export function createDiagnosticCollector<D extends { code: string }>(keyOf: (d: D) => string): DiagnosticCollector<D>;
export function createDiagnosticCollector<D extends { code: string }>(
  keyOf: (d: D) => string = engineDiagnosticKey as unknown as (d: D) => string,
): DiagnosticCollector<D> {
  const seen = new Set<string>();
  const ordered: D[] = [];
  return {
    emit(d) {
      const key = keyOf(d);
      if (seen.has(key)) return;
      seen.add(key);
      ordered.push(d);
    },
    drain() {
      const out = ordered.slice();
      ordered.length = 0;
      seen.clear();
      return out;
    },
  };
}
