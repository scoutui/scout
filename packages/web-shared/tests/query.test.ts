import { describe, it, expect } from "vitest";
import type { Component } from "@scoutui/scan-format";
import { toQueryView, friendlyKind, parseQuery, matchesQuery } from "../src/query.js";
import type { GovernanceRecord, Tag } from "../src/index.js";
import { component, packageExport, repoDeclaration, tag } from "./helpers/builders.js";

const ext = (): Component =>
  component(packageExport("@scope/lib", "Button"), { stats: { occurrenceCount: 5, fileCount: 1 }, version: "1.0.0" });

const webTag: Tag = {
  id: "t1",
  value: "web",
  category: "library",
  color: "#000",
  rule: { glob: ["@scope/*"], exact: [] },
};

describe("friendlyKind", () => {
  it("friendlyKind maps output kinds to short tokens", () => {
    expect(friendlyKind("react-component")).toBe("react");
    expect(friendlyKind("custom-element")).toBe("wc");
    expect(friendlyKind("vue-component")).toBe("vue");
  });
});

describe("toQueryView", () => {
  it("projects identity, stats, governance and tags", () => {
    const view = toQueryView(ext(), [], [webTag]);
    expect(view).toEqual({
      name: "Button",
      written: [],
      scope: "external",
      kind: "react",
      package: "@scope/lib",
      deprecated: false,
      occurrences: 5,
      tag: ["web"],
    });
  });

  it("local component has empty package and never a tag", () => {
    const view = toQueryView(component(repoDeclaration("r", "src/X.tsx", "X")), [], [webTag]);
    expect(view.scope).toBe("local");
    expect(view.package).toBe("");
    expect(view.tag).toEqual([]);
  });

  it("deprecated reflects governance", () => {
    const gov: GovernanceRecord[] = [
      {
        grain: "package",
        targetPackage: "@scope/lib",
        targetExport: null,
        disposition: { kind: "retired", reason: "x" },
        updatedAt: "2026-01-01",
      } as GovernanceRecord,
    ];
    expect(toQueryView(ext(), gov, []).deprecated).toBe(true);
  });

  it("projects a custom element from its tagName and its resolved package", () => {
    const element = component(tag("web-button"), {
      attribution: {
        status: "resolved", target: { kind: "package", packageName: "@scope/lib" }, confidence: "declared",
        evidence: [{ source: "cem", strength: "declared", locator: { packageName: "@scope/lib", version: null }, disposition: "supports" }],
      },
    });
    const view = toQueryView(element, [], [webTag]);
    expect(view.kind).toBe("wc");
    expect(view.name).toBe("web-button");
    expect(view.package).toBe("@scope/lib");
    expect(view.tag).toEqual(["web"]);
  });
});

describe("parseQuery", () => {
  it("empty input yields a null ast and no error (match-all)", () => {
    expect(parseQuery("   ")).toEqual({ ast: null, error: null });
  });
  it("valid query yields an ast", () => {
    expect(parseQuery("scope:local")).toEqual({
      ast: expect.objectContaining({
        type: "Tag",
        field: expect.objectContaining({ type: "Field", name: "scope" }),
        operator: expect.objectContaining({ operator: ":" }),
        expression: expect.objectContaining({ type: "LiteralExpression", value: "local" }),
      }),
      error: null,
    });
  });
  it("malformed query yields an error, not a throw", () => {
    const r = parseQuery('scope:"unterminated');
    expect(r.ast).toBeNull();
    expect(r.error).toBeTruthy();
  });
  it("caps overly long queries instead of parsing them (OOM guard)", () => {
    const huge = `name:${"a".repeat(3000)}`;
    const r = parseQuery(huge);
    expect(r.ast).toBeNull();          // null ast → projection treats as match-all
    expect(r.error).toBe("query too long");
  });
});

describe("matchesQuery (end-to-end)", () => {
  const run = (q: string, c = ext()) => {
    const { ast } = parseQuery(q);
    return ast ? matchesQuery(ast, c, [], [webTag]) : true;
  };
  it("filters by scope + kind + numeric occurrences", () => {
    expect(run("scope:external kind:react occurrences:>1")).toBe(true);
    expect(run("scope:local")).toBe(false);
    expect(run("occurrences:>100")).toBe(false);
  });
  it("name is substring, case-insensitive", () => {
    expect(run("name:butt")).toBe(true);
    expect(run("name:card")).toBe(false);
  });
  it("matches a resolved tag by value", () => {
    expect(run("tag:web")).toBe(true);
    expect(run("tag:legacy")).toBe(false);
  });
  it("supports boolean composition for free", () => {
    expect(run("kind:react OR kind:vue")).toBe(true);
    expect(run("scope:local OR occurrences:>1")).toBe(true);
  });
  it("returns false (does not throw) for a numeric comparison against a non-number", () => {
    // `occurrences:>foo` parses fine but liqe throws at eval; matchesQuery must swallow it.
    expect(parseQuery("occurrences:>foo").ast).not.toBeNull(); // it is a valid parse
    expect(run("occurrences:>foo")).toBe(false);
  });
  it("an unknown field matches nothing", () => {
    expect(run("color:blue")).toBe(false);
  });
});
