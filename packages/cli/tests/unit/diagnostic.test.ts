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
