/**
 * workspace-exports-resolution fixture: `@workspace-exports/consumer` imports
 * `@example/icons/icons/IcDemo`, a path that only the workspace package's
 * `exports` subpath pattern (`"./icons/*": "./src/icons/*.tsx"`) maps to a file,
 * and `@example/icons/badges`, a conditional subpath whose `default` target
 * (`./dist/badges.mjs`) doesn't exist and whose `types` target is the source.
 * The fixture's tsconfig has no `paths`, and both map into a folder other than
 * their subpath's, so nothing else can resolve them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("workspace-exports-resolution"));
}, 30_000);

describe("integration: workspace-exports-resolution fixture", () => {
  it("credits imports through a workspace package's `exports` pattern and conditional subpath to the declarations in the mapped files", () => {
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
        at: "packages/consumer/src/App.tsx:5:42",
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
      {
        at: "packages/consumer/src/App.tsx:6:28",
        component: {
          kind: "repository-declaration",
          repoId: "workspace-exports-resolution",
          filePath: "packages/icons/src/badge-set/index.tsx",
          exportName: "IcBadge",
        },
        owner: {
          kind: "repository-declaration",
          repoId: "workspace-exports-resolution",
          filePath: "packages/consumer/src/App.tsx",
          exportName: "Badge",
        },
        trace: [{ kind: "import", specifier: "@example/icons/badges", name: "IcBadge" }],
        props: {},
      },
    ]);
  });
});
