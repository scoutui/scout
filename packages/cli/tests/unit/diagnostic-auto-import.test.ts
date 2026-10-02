import { describe, expect, test } from "vitest";
import { createDiagnosticCollector, type Diagnostic } from "../../src/diagnostic.js";

describe("auto-import diagnostic codes", () => {
  test("auto-import-stale-entry dedups on componentName+target", () => {
    const c = createDiagnosticCollector();
    const d: Diagnostic = {
      code: "auto-import-stale-entry",
      severity: "warning",
      filePath: ".nuxt/components.d.ts",
      componentName: "StatusCard",
      target: "/repo/app/components/StatusCard.vue",
    };
    c.emit(d);
    c.emit({ ...d });
    expect(c.drain()).toHaveLength(1);
  });

  test("auto-import-manifest-missing dedups on filePath", () => {
    const c = createDiagnosticCollector();
    const d: Diagnostic = {
      code: "auto-import-manifest-missing",
      severity: "warning",
      filePath: "/repo/.nuxt/components.d.ts",
      detail: "run nuxt prepare",
    };
    c.emit(d);
    c.emit({ ...d, detail: "different detail, same observation" });
    expect(c.drain()).toHaveLength(1);
  });
});
