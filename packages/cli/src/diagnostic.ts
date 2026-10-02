import {
  createDiagnosticCollector as createCollector,
  engineDiagnosticKey,
  type DiagnosticCollector as Collector,
  type EngineDiagnostic,
} from "@scoutui/reference-graph";

/** Everything a scan reports: the engine's codes plus the CLI's own, a discriminated union by `code`. */
export type Diagnostic =
  | EngineDiagnostic
  // Auto-import manifest codes (generated component maps, e.g. Nuxt's
  // .nuxt/components.d.ts). Generic by design: the code names the mechanism
  // (auto-import), not a framework.
  | {
      code: "auto-import-stale-entry";
      severity: "warning";
      filePath: string;
      componentName: string;
      target: string;
    }
  | {
      code: "auto-import-manifest-missing";
      severity: "warning";
      filePath: string;
      detail: string;
    }
  // Resolver: barrel-walk codes.
  | {
      code: "cycle-detected";
      severity: "warning";
      filePath: string;
      exportName: string;
      packageName?: string;
    }
  | {
      code: "chain-too-deep";
      severity: "warning";
      filePath: string;
      exportName: string;
      depth: number;
      packageName?: string;
    }
  // Scan-level: a declared package with `package-not-installed` occurrences.
  | {
      code: "dependency-not-installed";
      severity: "warning";
      packageName: string;
      occurrenceCount: number;
      /** Repository-relative path of the package.json that declares the package. */
      declaredIn: string;
    };

export type DiagnosticCollector = Collector<Diagnostic>;

/**
 * The dedup key for every code: the CLI's codes here, the engine's through
 * `engineDiagnosticKey`.
 *
 * `cycle-detected` and `chain-too-deep` leave out `packageName`: the
 * diagnostic describes the barrel (file, exportName), not the consumer package
 * whose import reached it, so one barrel problem is reported once.
 */
function diagnosticKey(d: Diagnostic): string {
  switch (d.code) {
    case "auto-import-stale-entry":
      return `${d.code}::${d.componentName}::${d.target}`;
    case "auto-import-manifest-missing":
      return `${d.code}::${d.filePath}`;
    case "cycle-detected":
      return `${d.code}::${d.filePath}::${d.exportName}`;
    case "chain-too-deep":
      return `${d.code}::${d.filePath}::${d.exportName}`;
    case "dependency-not-installed":
      return `${d.code}::${d.packageName}`;
    default:
      return engineDiagnosticKey(d);
  }
}

export function createDiagnosticCollector(): DiagnosticCollector {
  return createCollector(diagnosticKey);
}
