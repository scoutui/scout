import { describe, expect, it } from "vitest";
import { rollupOccurrencesToComponents, type ComponentRow } from "../../src/rollup.js";
import type { ResolvedOccurrence } from "@scoutui/scan-format";

const occ = (componentId: string): ResolvedOccurrence => ({
  occurrenceId: `${componentId}-1`,
  resolution: { status: "resolved", componentId },
  filePath: "src/App.tsx",
  line: 1,
  column: 1,
  credit: { kind: "render" },
  trace: [],
  props: {},
});

const declaration = (filePath: string, exportName: string): ComponentRow["identity"] => ({
  kind: "repository-declaration",
  repoId: "r",
  filePath,
  exportName,
});

describe("usage stamping", () => {
  it("any occurrence → direct", () => {
    const [c] = rollupOccurrencesToComponents([occ("a")], [{ id: "a", identity: { kind: "tag", tagName: "x-a" } }]);
    expect(c!.usage).toBe("direct");
  });

  it("external at zero → none", () => {
    const [c] = rollupOccurrencesToComponents([], [{ id: "a", identity: { kind: "tag", tagName: "x-a" } }]);
    expect(c!.usage).toBe("none");
  });

  it("local zero-occ default export in a root file → root", () => {
    const [c] = rollupOccurrencesToComponents(
      [],
      [{ id: "a", isDefaultExport: true, identity: declaration("src/app/layout.tsx", "RootLayout") }],
    );
    expect(c!.usage).toBe("root");
  });

  it("local zero-occ root file but not default export → none", () => {
    const [c] = rollupOccurrencesToComponents(
      [],
      [{ id: "a", isDefaultExport: false, identity: declaration("src/app/page.tsx", "Helper") }],
    );
    expect(c!.usage).toBe("none");
  });

  it("local zero-occ non-root → none", () => {
    const [c] = rollupOccurrencesToComponents(
      [],
      [{ id: "a", isDefaultExport: true, identity: declaration("src/components/button.tsx", "Button") }],
    );
    expect(c!.usage).toBe("none");
  });
});
