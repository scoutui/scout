/**
 * workspace-exports-resolution fixture: `@workspace-exports/consumer` imports
 * `@example/icons/icons/IcDemo`, a path that only the workspace package's
 * `exports` subpath pattern (`"./icons/*": "./src/icons/*.tsx"`) maps to a file.
 * The fixture's tsconfig has no `paths`, and the pattern maps into a folder
 * other than its subpath's, so nothing else can resolve it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("workspace-exports-resolution"));
}, 30_000);

describe("integration: workspace-exports-resolution fixture", () => {
  it("credits an import through a workspace package's `exports` pattern to the declaration in the mapped file", () => {
    const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
    expect(
      out.occurrences.map((o) => ({
        at: `${o.filePath}:${o.line}:${o.column}`,
        component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
        owner: o.ownerComponentId === undefined ? undefined : identityOf.get(o.ownerComponentId),
        trace: o.trace,
        props: o.props,
      })),
    ).toEqual([
      {
        at: "packages/consumer/src/App.tsx:4:42",
        component: {
          kind: "repository-declaration",
          repoId: "workspace-exports-resolution",
          filePath: "packages/icons/src/icons/IcDemo.tsx",
          exportName: "IcDemo",
        },
        owner: {
          kind: "repository-declaration",
          repoId: "workspace-exports-resolution",
          filePath: "packages/consumer/src/App.tsx",
          exportName: "App",
        },
        trace: [{ kind: "import", specifier: "@example/icons/icons/IcDemo", name: "IcDemo" }],
        props: { size: { tier: "reference", ref: "props.size" } },
      },
    ]);
  });
});
