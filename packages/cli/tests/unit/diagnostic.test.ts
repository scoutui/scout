import { describe, expect, it } from "vitest";
import { createDiagnosticCollector, type Diagnostic } from "../../src/diagnostic.js";

const sampleResolverDiag: Diagnostic = {
  code: "cycle-detected",
  severity: "warning",
  filePath: "/abs/path/index.ts",
  exportName: "Foo",
  packageName: "@example/pkg",
};

const sampleEngineDiag: Diagnostic = {
  code: "unresolved-reference",
  severity: "info",
  filePath: "src/App.tsx",
  line: 42,
  column: 8,
  symbol: "Widget",
  memberChain: [],
};

const sampleLazyDiag: Diagnostic = {
  code: "lazy-import-unsupported",
  severity: "warning",
  filePath: "src/App.tsx",
  line: 4,
  column: 22,
  specifier: "./card.jsx",
  detail: "the import() target could not be resolved to a component",
};

describe("createDiagnosticCollector", () => {
  it("emits and drains in insertion order", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleResolverDiag);
    c.emit(sampleEngineDiag);
    expect(c.drain()).toEqual([sampleResolverDiag, sampleEngineDiag]);
  });

  it("drain clears the collector", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleResolverDiag);
    expect(c.drain()).toHaveLength(1);
    expect(c.drain()).toEqual([]);
  });

  it("dedups by (code + identifying fields)", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleResolverDiag);
    c.emit(sampleResolverDiag); // same shape, so deduped
    expect(c.drain()).toEqual([sampleResolverDiag]);
  });

  it("does not dedup diagnostics with different code", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleResolverDiag);
    c.emit(sampleEngineDiag);
    expect(c.drain()).toHaveLength(2);
  });

  it("does not dedup diagnostics with different file/line", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleEngineDiag);
    c.emit({ ...sampleEngineDiag, line: 99 });
    expect(c.drain()).toHaveLength(2);
  });
});

describe("unresolved-reference", () => {
  it("accepts unresolved-reference shape", () => {
    const c = createDiagnosticCollector();
    const diag: Diagnostic = {
      code: "unresolved-reference",
      severity: "info",
      filePath: "src/App.tsx",
      line: 1,
      column: 1,
      symbol: "Foo",
      memberChain: [],
    };
    c.emit(diag);
    expect(c.drain()).toEqual([diag]);
  });
});

describe("lazy-import-unsupported", () => {
  it("dedups two emits differing only in detail", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleLazyDiag);
    c.emit({ ...sampleLazyDiag, detail: "a different wording" });
    expect(c.drain()).toEqual([sampleLazyDiag]);
  });

  it("does not dedup two emits differing in specifier", () => {
    const c = createDiagnosticCollector();
    c.emit(sampleLazyDiag);
    c.emit({ ...sampleLazyDiag, specifier: "./other.jsx" });
    expect(c.drain()).toHaveLength(2);
  });
});

describe("angular-compiler-unsupported", () => {
  const sample: Diagnostic = {
    code: "angular-compiler-unsupported",
    severity: "warning",
    filePath: "package.json",
    version: "18",
    detail: "The installed @angular/compiler is version 18, older than the Angular 19+ Scout supports.",
  };

  it("dedups two emits (there's only ever one installed compiler) even if the detail wording differs", () => {
    const c = createDiagnosticCollector();
    c.emit(sample);
    c.emit({ ...sample, detail: "a different wording" });
    expect(c.drain()).toEqual([sample]);
  });
});

describe("angular-not-in-scope", () => {
  const sample: Diagnostic = {
    code: "angular-not-in-scope",
    severity: "info",
    filePath: "src/app.component.html",
    line: 2,
    column: 3,
    tagName: "app-thing",
    candidates: ["src/thing.component.ts#ThingComponent"],
  };

  it("dedups two emits at the same file/line/column", () => {
    const c = createDiagnosticCollector();
    c.emit(sample);
    c.emit({ ...sample, candidates: ["src/thing.component.ts#ThingComponent", "src/other/thing.component.ts#OtherThing"] });
    expect(c.drain()).toEqual([sample]);
  });

  it("does not dedup two emits at different lines", () => {
    const c = createDiagnosticCollector();
    c.emit(sample);
    c.emit({ ...sample, line: 9 });
    expect(c.drain()).toHaveLength(2);
  });
});

describe("angular-template-missing", () => {
  const sample: Diagnostic = {
    code: "angular-template-missing",
    severity: "warning",
    filePath: "src/app.component.ts",
    templateUrl: "./app.component.html",
  };

  it("dedups two emits for the same component and templateUrl", () => {
    const c = createDiagnosticCollector();
    c.emit(sample);
    c.emit({ ...sample });
    expect(c.drain()).toEqual([sample]);
  });

  it("does not dedup two emits with different templateUrls", () => {
    const c = createDiagnosticCollector();
    c.emit(sample);
    c.emit({ ...sample, templateUrl: "./other.html" });
    expect(c.drain()).toHaveLength(2);
  });
});
