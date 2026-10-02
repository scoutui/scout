import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateArtifact } from "../src/validate.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/minimal.json", import.meta.url), "utf8"));
const invalidAt = (path: string) => ({ ok: false, reason: "invalid_artifact", path });

/** The keys and indexes of a path written as `validateArtifact` reports it, such as `occurrences[0].credit`. */
const keysOf = (path: string) => path.split(/[.[\]]/).filter(Boolean).map((key) => (/^\d+$/.test(key) ? Number(key) : key));
const getAt = (root: ReturnType<typeof fixture>, path: string) => keysOf(path).reduce((node, key) => node[key], root);
/** Writes `value` at `path`, or deletes the key there when `value` is undefined. */
function setAt(root: ReturnType<typeof fixture>, path: string, value: unknown): void {
  const keys = keysOf(path);
  const last = keys.pop() as string | number;
  const parent = keys.reduce((node, key) => node[key], root);
  if (value === undefined) Reflect.deleteProperty(parent, last);
  else parent[last] = value;
}

describe("validateArtifact", () => {
  it("accepts a well-formed artefact and returns the input object, unknown keys included", () => {
    const a = fixture(); a.meta.extra = "kept";
    const result = validateArtifact(a);
    expect(result.ok).toBe(true);
    expect(result.ok && result.artifact).toBe(a);
    expect(result.ok && result.artifact.meta).toHaveProperty("extra", "kept");
  });
  it("reports an unsupported version before any shape check", () => {
    const next = fixture(); next.meta.schemaVersion = 3; next.components = "not an array";
    expect(validateArtifact(next)).toEqual({ ok: false, reason: "unsupported_version", version: 3 });
    const v1 = fixture(); Reflect.deleteProperty(v1.meta, "schemaVersion");
    expect(validateArtifact(v1)).toEqual({ ok: false, reason: "unsupported_version", version: 1 });
  });
  it("reports a non-object as an invalid version", () => {
    expect(validateArtifact(null)).toEqual({ ok: false, reason: "unsupported_version", version: "invalid" });
  });
  it("rejects a component id that isn't its identity's key", () => {
    const a = fixture(); a.components[0].id = "0123456789abcdef";
    expect(validateArtifact(a)).toEqual(invalidAt("components[0].id"));
  });
  it("rejects a duplicate component id", () => {
    const a = fixture(); a.components.push(structuredClone(a.components[0]));
    expect(validateArtifact(a)).toEqual(invalidAt("components[2].id"));
  });
  it("rejects a duplicate occurrence id", () => {
    const a = fixture(); a.occurrences[1].occurrenceId = a.occurrences[0].occurrenceId;
    expect(validateArtifact(a)).toEqual(invalidAt("occurrences[1].occurrenceId"));
  });
  it("rejects a resolved occurrence naming no component", () => {
    const a = fixture(); a.occurrences[0].resolution.componentId = "0000000000000000";
    expect(validateArtifact(a)).toEqual(invalidAt("occurrences[0].resolution.componentId"));
  });
  it("rejects an unresolved occurrence that names a component", () => {
    const a = fixture(); a.occurrences[2].resolution.componentId = a.components[0].id;
    expect(validateArtifact(a)).toEqual(invalidAt("occurrences[2].resolution.componentId"));
  });
  it("rejects attribution on a non-tag component", () => {
    const a = fixture(); a.components[0].attribution = { status: "unknown", reason: "absent", evidence: [] };
    expect(validateArtifact(a)).toEqual(invalidAt("components[0].attribution"));
  });
  it("requires framework on a package export and rejects it on a tag", () => {
    const missing = fixture(); Reflect.deleteProperty(missing.components[0], "framework");
    expect(validateArtifact(missing)).toEqual(invalidAt("components[0].framework"));
    const onTag = fixture(); onTag.components[1].framework = "react";
    expect(validateArtifact(onTag)).toEqual(invalidAt("components[1].framework"));
  });

  it.each([
    ["a credit's kind", "occurrences[0].credit", { kind: "slot", slotName: "header" }],
    ["a trace step's kind", "occurrences[1].trace[0]", { kind: "portal", target: "modal-root" }],
    ["an unresolved reason's kind", "occurrences[2].resolution.reason", { kind: "private-registry", registry: "internal" }],
    ["a chain-bailed reason's code", "occurrences[2].resolution.reason", { kind: "chain-bailed", code: "timed-out" }],
    ["an evidence record's source", "components[1].attribution.evidence[0].source", "html-data"],
    ["an evidence record's disposition", "components[1].attribution.evidence[0].disposition", "superseded"],
    ["an evidence record's strength", "components[1].attribution.evidence[0].strength", "inferred"],
    ["a resolved attribution's confidence", "components[1].attribution.confidence", "inferred"],
    ["a conflict attribution's strongestClass", "components[1].attribution", { status: "conflict", strongestClass: "inferred", candidates: [], evidence: [] }],
    ["an unknown attribution's reason", "components[1].attribution", { status: "unknown", reason: "ambiguous", evidence: [] }],
  ])("accepts a value it doesn't know in %s, kept as written", (_list, path, value) => {
    const a = fixture(); setAt(a, path, structuredClone(value));
    const result = validateArtifact(a);
    expect(result.ok).toBe(true);
    expect(result.ok && getAt(result.artifact, path)).toEqual(value);
  });

  it.each([
    ["an identity's kind", "components[0].identity.kind", "module"],
    ["a resolution's status", "occurrences[0].resolution.status", "deferred"],
    ["an attribution's status", "components[1].attribution.status", "disputed"],
    ["an attribution target's kind", "components[1].attribution.target.kind", "registry"],
    ["a component's framework", "components[0].framework", "svelte"],
    ["a component's usage", "components[0].usage", "indirect"],
  ])("rejects a value it doesn't know in %s, at its path", (_list, path, value) => {
    const a = fixture(); setAt(a, path, value);
    expect(validateArtifact(a)).toEqual(invalidAt(path));
  });

  it.each([
    ["an argument credit without its index", "occurrences[1].credit.index", undefined],
    ["an argument credit whose index isn't a number", "occurrences[1].credit.index", "0"],
    ["an import step without its name", "occurrences[1].trace[0].name", undefined],
    ["a package-not-installed reason without its package", "occurrences[2].resolution.reason.packageName", undefined],
    ["an evidence strength that isn't a string", "components[1].attribution.evidence[0].strength", 1],
    ["an empty credit kind", "occurrences[0].credit.kind", ""],
    ["an empty evidence disposition", "components[1].attribution.evidence[0].disposition", ""],
    ["a scan without its commit date", "meta.repo.committedAt", undefined],
    ["a commit date that isn't a timestamp", "meta.repo.committedAt", "not a date"],
    ["a branch position that isn't a whole number", "meta.repo.branchPosition", 1.5],
    ["a negative branch position", "meta.repo.branchPosition", -1],
  ])("rejects %s, at that field", (_case, path, value) => {
    const a = fixture(); setAt(a, path, value);
    expect(validateArtifact(a)).toEqual(invalidAt(path));
  });
});
