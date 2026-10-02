import { describe, it, expect } from "vitest";
import { scan, relResolver } from "./shape-helpers.js";

const NS = `export const NS = {
  Inline: () => <div />,
};
`;

describe("definition on a compound member with no declaration of its own", () => {
  it("stamps the holder's declaration position when rendered in the holder's file", () => {
    const occs = scan({ "src/ns.tsx": `${NS}export const Here = () => <NS.Inline />;\n` }, relResolver("/repo"), "/repo");
    const occ = occs.find((o) => (o.rawComponentId as { export?: string }).export === "NS.Inline");
    expect(occ?.definition).toEqual({ line: 1, column: 13 });
  });

  it("stamps the same position when rendered from another file", () => {
    const occs = scan(
      {
        "src/ns.tsx": NS,
        "src/App.tsx": `import { NS } from "./ns";\nexport const App = () => <NS.Inline />;\n`,
      },
      relResolver("/repo"),
      "/repo",
    );
    const occ = occs.find((o) => (o.rawComponentId as { export?: string }).export === "NS.Inline");
    expect(occ?.filePath).toBe("src/App.tsx");
    expect(occ?.definition).toEqual({ line: 1, column: 13 });
  });

  it("stamps the same position when rendered through a workspace-sibling import", () => {
    const occs = scan(
      {
        "packages/ui/src/index.tsx": NS,
        "apps/web/src/App.tsx": `import { NS } from "@acme/ui";\nexport const App = () => <NS.Inline />;\n`,
      },
      (_from, spec) => (spec === "@acme/ui" ? "/repo/packages/ui/src/index.tsx" : null),
      "/repo",
    );
    const occ = occs.find((o) => (o.rawComponentId as { export?: string }).export === "NS.Inline");
    expect(occ?.rawComponentId).toEqual({
      kind: "react-component",
      export: "NS.Inline",
      source: { type: "local", filePath: "packages/ui/src/index.tsx" },
    });
    expect(occ?.filePath).toBe("apps/web/src/App.tsx");
    expect(occ?.definition).toEqual({ line: 1, column: 13 });
  });

  it("takes no definition from the holder when the member resolves to its own declaration in the holder's file", () => {
    const occs = scan(
      {
        "src/impl.tsx": "export const Impl = () => <div />;\n",
        "src/ns.tsx": `import { Impl } from "./impl";\nexport const NS = { Inline: Impl };\nexport const Here = () => <NS.Inline />;\n`,
      },
      relResolver("/repo"),
      "/repo",
    );
    const occ = occs.find((o) => (o.rawComponentId as { export?: string }).export === "Impl");
    expect(occ?.rawComponentId).toEqual({
      kind: "react-component",
      export: "Impl",
      source: { type: "local", filePath: "src/impl.tsx" },
    });
    expect(occ?.filePath).toBe("src/ns.tsx");
    expect(occ?.definition).toBeUndefined();
  });

  it("takes no definition from the holder when the member resolves to its own declaration", () => {
    const occs = scan(
      {
        "src/impl.tsx": "export const Impl = () => <div />;\n",
        "src/ns.tsx": `import { Impl } from "./impl";\nexport const NS = { Inline: Impl };\n`,
        "src/App.tsx": `import { NS } from "./ns";\nexport const App = () => <NS.Inline />;\n`,
      },
      relResolver("/repo"),
      "/repo",
    );
    const occ = occs.find((o) => (o.rawComponentId as { export?: string }).export === "Impl");
    expect(occ?.rawComponentId).toEqual({
      kind: "react-component",
      export: "Impl",
      source: { type: "local", filePath: "src/impl.tsx" },
    });
    expect(occ?.definition).toBeUndefined();
  });

  it("takes no definition from the holder through a workspace-sibling import either", () => {
    const occs = scan(
      {
        "packages/ui/src/impl.tsx": "export const Impl = () => <div />;\n",
        "packages/ui/src/index.tsx": `import { Impl } from "./impl";\nexport const NS = { Inline: Impl };\n`,
        "apps/web/src/App.tsx": `import { NS } from "@acme/ui";\nexport const App = () => <NS.Inline />;\n`,
      },
      (_from, spec) =>
        spec === "@acme/ui"
          ? "/repo/packages/ui/src/index.tsx"
          : spec === "./impl"
            ? "/repo/packages/ui/src/impl.tsx"
            : null,
      "/repo",
    );
    const occ = occs.find((o) => (o.rawComponentId as { export?: string }).export === "Impl");
    expect(occ?.rawComponentId).toEqual({
      kind: "react-component",
      export: "Impl",
      source: { type: "local", filePath: "packages/ui/src/impl.tsx" },
    });
    expect(occ?.definition).toBeUndefined();
  });
});
