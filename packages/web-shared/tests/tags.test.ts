import { describe, it, expect } from "vitest";
import {
  TagSchema,
  TagInputSchema,
  TagRefSchema,
} from "../src/dto.js";
import { resolveTags, attachTags, libraryTags } from "../src/tags.js";
import type { Tag } from "../src/dto.js";

const web: Tag = { id: "web", value: "web", category: "library", color: "violet", rule: { glob: ["@example/web-*"], exact: [] } };
const legacy: Tag = { id: "legacy", value: "legacy", category: "library", color: "berry", rule: { glob: [], exact: ["legacy-design-system"] } };

describe("resolveTags", () => {
  it("matches glob", () => {
    expect(resolveTags("@example/web-button", [web, legacy]).map(t => t.id)).toEqual(["web"]);
  });
  it("matches exact", () => {
    expect(resolveTags("legacy-design-system", [web, legacy]).map(t => t.id)).toEqual(["legacy"]);
  });
  it("returns [] for null packageName (local components)", () => {
    expect(resolveTags(null, [web, legacy])).toEqual([]);
  });
  it("returns [] when nothing matches", () => {
    expect(resolveTags("react", [web, legacy])).toEqual([]);
  });
  it("can match multiple tags", () => {
    const also: Tag = { id: "all", value: "all", category: "library", color: "teal", rule: { glob: ["*"], exact: [] } };
    expect(resolveTags("@example/web-button", [web, also]).map(t => t.id).sort()).toEqual(["all", "web"]);
  });
  it("escapes regex metachars in globs", () => {
    const dotty: Tag = { id: "d", value: "d", category: null, color: "teal", rule: { glob: ["a.b-*"], exact: [] } };
    expect(resolveTags("axb-1", [dotty])).toEqual([]);   // '.' is literal, not wildcard
    expect(resolveTags("a.b-1", [dotty]).map(t => t.id)).toEqual(["d"]);
  });
  it("treats ? as a literal, not a regex quantifier (only * is special)", () => {
    const q: Tag = { id: "q", value: "q", category: null, color: "teal", rule: { glob: ["a?b-*"], exact: [] } };
    expect(resolveTags("ab-1", [q])).toEqual([]);                 // '?' literal → 'a?b-' required
    expect(resolveTags("a?b-1", [q]).map(t => t.id)).toEqual(["q"]);
    const lead: Tag = { id: "l", value: "l", category: null, color: "teal", rule: { glob: ["?x"], exact: [] } };
    expect(() => resolveTags("?x", [lead])).not.toThrow();       // leading ? must not crash new RegExp
    expect(resolveTags("?x", [lead]).map(t => t.id)).toEqual(["l"]);
  });
});

describe("tag schemas", () => {
  it("parses a full Tag", () => {
    const tag = {
      id: "t1",
      value: "web",
      category: "library",
      color: "violet",
      rule: { glob: ["@example/web-*"], exact: ["legacy-design-system"] },
    };
    expect(TagSchema.parse(tag)).toEqual(tag);
  });

  it("allows null category and id-less TagInput", () => {
    const input = { value: "legacy", category: null, color: "berry", rule: { glob: [], exact: [] } };
    expect(TagInputSchema.parse(input)).toEqual(input);
  });

  it.each(["grey", "#009598", ""])("rejects a tag colour of %j", (color) => {
    expect(TagInputSchema.safeParse({ value: "legacy", category: null, color, rule: { glob: [], exact: [] } }).success).toBe(false);
  });

  it("parses a TagRef", () => {
    const ref = { id: "t1", value: "web", category: "library", color: "violet" };
    expect(TagRefSchema.parse(ref)).toEqual(ref);
  });

  it("rejects a TagRef without a color", () => {
    expect(TagRefSchema.safeParse({ id: "t1", value: "web", category: "library" }).success).toBe(false);
  });

});

describe("attachTags", () => {
  it("adds a tags array per row by packageName", () => {
    const rows = [{ packageName: "@example/web-button" }, { packageName: "react" }, { packageName: null }];
    const out = attachTags(rows, [web]);
    expect(out[0].tags.map(t => t.id)).toEqual(["web"]);
    expect(out[1].tags).toEqual([]);
    expect(out[2].tags).toEqual([]);
  });
  it("preserves other row fields", () => {
    const out = attachTags([{ packageName: "react", occ: 5 }], [web]);
    expect(out[0].occ).toBe(5);
  });
});

const mk = (id: string, value: string, glob: string[], category: string | null = "library"): Tag =>
  ({ id, value, category, color: "teal", rule: { glob, exact: [] } });

describe("libraryTags", () => {
  it("keeps only category === 'library', sorted by value", () => {
    const tags = [mk("2", "legacy", ["legacy-*"]), mk("1", "web", ["@x/web-*"]), mk("3", "misc", ["m-*"], null)];
    expect(libraryTags(tags).map(t => t.value)).toEqual(["legacy", "web"]);
  });
});
