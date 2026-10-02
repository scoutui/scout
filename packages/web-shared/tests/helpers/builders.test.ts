import { describe, expect, it } from "vitest";
import { validateArtifact } from "@scoutui/scan-format";
import { tinyArtifact } from "../fixtures/tiny-artifact.js";
import { genericArtifacts, overlays } from "./fixtures.js";
import { mkArtifact } from "./mkArtifact.js";
import { artifact, component, packageExport, resolvedAt, tag, unresolvedAt } from "./builders.js";

describe("scan file builders", () => {
  it("builds a valid package export occurrence", () => {
    const button = component(packageExport("@example/ui", "Button"));
    const scan = artifact({ components: [button], occurrences: [resolvedAt(button, "src/App.tsx")] });

    expect(validateArtifact(scan).ok).toBe(true);
  });

  it("builds a valid tag with resolved package attribution", () => {
    const button = component(tag("example-button"), {
      attribution: {
        status: "resolved",
        target: { kind: "package", packageName: "@example/ui" },
        confidence: "observed",
        evidence: [],
      },
    });
    const scan = artifact({ components: [button], occurrences: [resolvedAt(button, "src/App.tsx")] });

    expect(validateArtifact(scan).ok).toBe(true);
    expect(button.framework).toBeUndefined();
  });

  it("derives component counts and usage from resolved call sites", () => {
    const button = component(packageExport("@example/ui", "Button"));
    const scan = artifact({
      components: [button],
      occurrences: [
        resolvedAt(button, "src/App.tsx", 1),
        resolvedAt(button, "src/Other.tsx", 2),
        unresolvedAt({ kind: "module-not-found" }, "src/Missing.tsx"),
      ],
    });

    expect(scan.components[0]?.stats).toEqual({ occurrenceCount: 2, fileCount: 2 });
    expect(scan.components[0]?.usage).toBe("direct");
  });

  it("keeps the shared fixtures valid scan files", () => {
    const generated = mkArtifact({ repoId: "repo", scanId: "scan", scannedAt: "2026-01-01T00:00:00Z", components: [{ scope: "external", packageName: "@example/ui", occ: 2 }] });
    const scans = [tinyArtifact(), generated, ...genericArtifacts()];

    for (const scan of scans) expect(validateArtifact(scan).ok).toBe(true);
  });

  it("materializes the requested occurrence count in mkArtifact", () => {
    const generated = mkArtifact({ repoId: "repo", scanId: "scan", scannedAt: "2026-01-01T00:00:00Z", components: [{ scope: "external", packageName: "@example/ui", occ: 2 }] });

    expect(generated.occurrences).toHaveLength(2);
  });

  function currentOracle() {
    const current = genericArtifacts()[0];
    if (!current) throw new Error("Missing current oracle scan");
    return current;
  }

  it("covers package exports, repository declarations, and tags", () => {
    const current = currentOracle();
    expect(new Set(current.components.map((item) => item.identity.kind))).toEqual(new Set(["package-export", "repository-declaration", "tag"]));
  });

  it("covers all three tag attribution statuses", () => {
    const current = currentOracle();
    expect(current.components.filter((item) => item.identity.kind === "tag").map((item) => item.attribution?.status).sort()).toEqual(["conflict", "resolved", "unknown"]);
  });

  it("covers compound members", () => {
    const current = currentOracle();
    expect(current.components.some((item) => item.identity.kind === "package-export" && item.identity.exportName === "Button.Icon")).toBe(true);
  });

  it("distinguishes same-named exports by public entry", () => {
    const current = currentOracle();
    expect(current.components.filter((item) => item.identity.kind === "package-export" && item.identity.exportName === "Button").flatMap((item) => (item.identity.kind === "package-export" ? [item.identity.publicEntry] : [])).sort()).toEqual(["", "./alternate"]);
  });

  it("covers unresolved occurrences", () => {
    const current = currentOracle();
    expect(current.occurrences.filter((item) => item.resolution.status === "unresolved")).toHaveLength(1);
  });

  function childCallSite() {
    return currentOracle().occurrences.find((item) => item.occurrenceId === "child");
  }

  it("covers observed props on the child call site", () => {
    const child = childCallSite();
    // biome-ignore lint/complexity/useLiteralKeys: index-signature access
    expect(child?.props["size"]).toEqual({ tier: "written", value: "small" });
  });

  it("covers events on the child call site", () => {
    const child = childCallSite();
    expect(child?.events).toEqual(["click"]);
  });

  it("covers the child call site's composition owner", () => {
    const child = childCallSite();
    expect(child?.ownerComponentId).toBeTruthy();
  });

  it("covers changed and cleared overlays", () => {
    expect(overlays.map((item) => item.name)).toEqual(["initial", "changed", "cleared"]);
  });
});
