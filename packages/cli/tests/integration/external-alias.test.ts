/**
 * external-alias fixture: `src/App.tsx` aliases an import from an installed
 * package the scan doesn't parse (`const AliasedButton = Button`) and renders
 * the alias.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("external-alias"));
}, 30_000);

describe("integration: external-alias fixture", () => {
  it("credits a render through a local alias to the package export it aliases", () => {
    const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
    expect(
      out.occurrences.map((o) => ({
        at: `${o.filePath}:${o.line}:${o.column}`,
        component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
        owner: o.ownerComponentId === undefined ? undefined : identityOf.get(o.ownerComponentId),
        writtenName: o.writtenName,
        trace: o.trace,
      })),
    ).toEqual([
      {
        at: "src/App.tsx:6:10",
        component: { kind: "package-export", packageName: "@example/react-ds", publicEntry: "", exportName: "Button" },
        owner: { kind: "repository-declaration", repoId: "external-alias", filePath: "src/App.tsx", exportName: "App" },
        writtenName: "AliasedButton",
        trace: [],
      },
    ]);
  });
});
