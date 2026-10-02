/**
 * star-reexport-barrel fixture: the workspace package `@example/ds` exports
 * its components from `src/index.ts` with `export * from "./Widget"`, and
 * `@example/consumer` imports `Widget` from the package.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("star-reexport-barrel"));
}, 30_000);

describe("integration: star-reexport-barrel fixture", () => {
  it("credits an import through an `export *` entry to the declaration it re-exports", () => {
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
        at: "packages/consumer/src/App.tsx:3:25",
        component: {
          kind: "repository-declaration",
          repoId: "star-reexport-barrel",
          filePath: "packages/ds/src/Widget.tsx",
          exportName: "Widget",
        },
        owner: {
          kind: "repository-declaration",
          repoId: "star-reexport-barrel",
          filePath: "packages/consumer/src/App.tsx",
          exportName: "App",
        },
        trace: [{ kind: "import", specifier: "@example/ds", name: "Widget" }],
        props: { label: { tier: "written", value: "hi" } },
      },
    ]);
  });
});
