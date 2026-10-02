import { describe, expect, it } from "vitest";
import { scan } from "./shape-helpers.js";

describe("external-leaf relabel", () => {
  it("keys a relabelled import by the host's public entry as given, the same as a direct import of that entry", () => {
    const occs = scan(
      {
        "src/Agg.tsx": `import { X } from "@example/agg/x"; export const Agg = () => <X />;`,
        "src/Direct.tsx": `import { X } from "@example/leaf/dist/x.cjs.js"; export const Direct = () => <X />;`,
      },
      () => null,
      undefined,
      {
        resolveExternalLeaf: (_from, specifier) =>
          specifier === "@example/agg/x" ? { leafPackage: "@example/leaf", publicEntry: "dist/x.cjs", exportName: "X" } : null,
      },
    );
    expect(occs.map((o) => [o.filePath, o.rawComponentId])).toEqual([
      ["src/Agg.tsx", { kind: "react-component", export: "X", source: { type: "external", package: "@example/leaf", publicEntry: "dist/x.cjs" } }],
      ["src/Direct.tsx", { kind: "react-component", export: "X", source: { type: "external", package: "@example/leaf", publicEntry: "dist/x.cjs" } }],
    ]);
  });
});
