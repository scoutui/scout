import { describe, expect, it } from "vitest";
import type { AttributionTarget, Component, EvidenceRecord } from "@scoutui/scan-format";
import { governanceKey, presentIdentity } from "../src/present-identity.js";
import { component, packageExport, repoDeclaration, tag } from "./helpers/builders.js";

const cem: EvidenceRecord = { source: "cem", strength: "declared", locator: { packageName: "@example/ui", version: "1.0.0" }, disposition: "supports" };
const registration: EvidenceRecord = { source: "registration", strength: "observed", locator: { filePath: "src/define.ts", line: 3 }, disposition: "supports" };
const globalDeclaration: EvidenceRecord = { source: "global-declaration", strength: "declared", locator: { filePath: "src/globals.d.ts", line: 1 }, disposition: "supports" };

function unknownTag(evidence: EvidenceRecord[]): Component {
  return component(tag("x-card"), { attribution: { status: "unknown", reason: "unresolved", evidence } });
}

function resolvedTag(target: AttributionTarget, evidence: EvidenceRecord[]): Component {
  return component(tag("x-card"), { attribution: { status: "resolved", target, confidence: "observed", evidence } });
}

describe("presentIdentity", () => {
  it("presents a package export as external, disambiguated by its public entry", () => {
    const button = component(packageExport("@example/ui", "Button", "dist/x"));
    expect(presentIdentity(button)).toEqual({
      scope: "external", kind: "react-component", packageName: "@example/ui",
      exportName: "Button", tagName: null, filePath: null, publicEntry: "dist/x",
    });
    expect(governanceKey(button)).toEqual({ packageName: "@example/ui", name: "Button" });
  });

  it("presents a repository declaration as local, by file path, and never governed", () => {
    const panel = component(repoDeclaration("repo-a", "src/panel.vue", "Panel"), { framework: "vue" });
    expect(presentIdentity(panel)).toEqual({
      scope: "local", kind: "vue-component", packageName: null,
      exportName: "Panel", tagName: null, filePath: "src/panel.vue", publicEntry: null,
    });
    expect(governanceKey(panel)).toBeNull();
  });

  it("presents a repository declaration's workspace package, still local and never governed", () => {
    const panel = component(repoDeclaration("repo-a", "packages/app-kit/src/panel.tsx", "Panel"), { owningPackage: "@example/app-kit" });
    expect(presentIdentity(panel)).toMatchObject({ scope: "local", packageName: "@example/app-kit" });
    expect(governanceKey(panel)).toBeNull();
  });

  it.each([
    ["a CEM declaration", [cem], "custom-element"],
    ["only a registration, even a contradicting one without a target", [{ ...registration, disposition: "contradicts" as const }], "custom-element"],
    ["only a global declaration", [globalDeclaration], "tag"],
    ["only evidence from a source it doesn't know", [{ ...cem, source: "html-data" }], "tag"],
    ["no evidence", [], "tag"],
  ])("classifies a tag with %s", (_, evidence, kind) => {
    const card = unknownTag(evidence);
    expect(card.framework).toBeUndefined();
    expect(presentIdentity(card).kind).toBe(kind);
  });

  it("presents a tag resolved to a package as external, governed under that package", () => {
    const card = resolvedTag({ kind: "package", packageName: "@example/ui" }, [cem]);
    expect(presentIdentity(card)).toEqual({
      scope: "external", kind: "custom-element", packageName: "@example/ui",
      exportName: null, tagName: "x-card", filePath: null, publicEntry: null,
    });
    expect(governanceKey(card)).toEqual({ packageName: "@example/ui", name: "x-card" });
  });

  it("presents a tag resolved to a repository as local and never governed", () => {
    const target: AttributionTarget = { kind: "repository", repoId: "repo-a", filePath: "src/card.ts", exportName: "Card" };
    const card = resolvedTag(target, [{ ...registration, target }]);
    expect(presentIdentity(card)).toMatchObject({ scope: "local", packageName: null, filePath: "src/card.ts" });
    expect(governanceKey(card)).toBeNull();
  });

  it.each([
    ["unknown", unknownTag([])],
    ["conflicting", component(tag("x-card"), {
      attribution: { status: "conflict", strongestClass: "observed", candidates: [{ kind: "package", packageName: "@example/ui" }, { kind: "package", packageName: "@example/other" }], evidence: [] },
    })],
  ])("gives an %s tag no package and no governance key", (_, card) => {
    expect(presentIdentity(card).packageName).toBeNull();
    expect(governanceKey(card)).toBeNull();
  });
});
