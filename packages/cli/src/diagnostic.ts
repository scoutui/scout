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
  // A file the walk matched that the scan couldn't read or parse.
  | {
      code: "file-not-parsed";
      severity: "warning";
      filePath: string;
      reason: string;
    }
  // Angular: an element whose selector more than one component in scope
  // declares. Angular itself rejects this, so the use isn't counted.
  | {
      code: "angular-selector-ambiguous";
      severity: "warning";
      filePath: string;
      line: number;
      column: number;
      tagName: string;
      /** The matching components, as `<file or package>#<export>`. */
      candidates: string[];
    }
  // Angular: component files were found but `@angular/compiler` isn't
  // installed where the repo would load it, so their templates weren't read.
  | {
      code: "angular-compiler-missing";
      severity: "warning";
      filePath: string;
      detail: string;
    }
  // Angular: the installed `@angular/compiler` is older than Scout supports.
  // Scanning continues, but a template its parser reads differently may be
  // missed or misread.
  | {
      code: "angular-compiler-unsupported";
      severity: "warning";
      filePath: string;
      version: string;
      detail: string;
    }
  // Angular: a template element whose selector matches one or more
  // components, none of them in scope. Angular would reject this too, so in a
  // repo that builds, it's usually a sign the scan's own scope reading missed
  // something (a standalone component's `imports`, or an NgModule's
  // declarations/exports).
  | {
      code: "angular-not-in-scope";
      severity: "info";
      filePath: string;
      line: number;
      column: number;
      tagName: string;
      /** The out-of-scope matches, as `<file or package>#<export>`. */
      candidates: string[];
    }
  // Angular: a component's `templateUrl` names a file the scan couldn't read,
  // so that component's template wasn't counted.
  | {
      code: "angular-template-missing";
      severity: "warning";
      /** The component's own file, outputRoot-relative. */
      filePath: string;
      templateUrl: string;
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
    case "file-not-parsed":
      return `${d.code}::${d.filePath}`;
    case "cycle-detected":
      return `${d.code}::${d.filePath}::${d.exportName}`;
    case "chain-too-deep":
      return `${d.code}::${d.filePath}::${d.exportName}`;
    case "dependency-not-installed":
      return `${d.code}::${d.packageName}`;
    case "angular-selector-ambiguous":
    case "angular-not-in-scope":
      return `${d.code}::${d.filePath}::${d.line}::${d.column}`;
    case "angular-compiler-missing":
    case "angular-compiler-unsupported":
      return `${d.code}::${d.filePath}`;
    case "angular-template-missing":
      return `${d.code}::${d.filePath}::${d.templateUrl}`;
    default:
      return engineDiagnosticKey(d);
  }
}

export function createDiagnosticCollector(): DiagnosticCollector {
  return createCollector(diagnosticKey);
}
