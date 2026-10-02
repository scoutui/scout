import { describe, it, expect } from "vitest";
import { joinTerms, nameTerm, orGroup, readTerms, term } from "@/lib/query-terms";

describe("term", () => {
  it.each([
    ["a single word, bare", "button", "name:button"],
    ["a scoped package name, quoted", "@scope/pkg", 'package:"@scope/pkg"'],
    ["a multi-word value, quoted", "icon set", 'tag:"icon set"'],
    ["a value with a colon, quoted", "a:b", 'tag:"a:b"'],
    ["a value with parens, quoted", "a(b)", 'tag:"a(b)"'],
    ["a value with double quotes, which are dropped", 'say "hi"', 'tag:"say hi"'],
  ])("writes %s", (_case, value, expected) => {
    const field = expected.slice(0, expected.indexOf(":"));
    expect(term(field, value)).toBe(expected);
  });
});

describe("orGroup", () => {
  it.each([
    ["no values as no term", [], ""],
    ["one value as a plain term", ["ds"], "tag:ds"],
    ["several values as an OR group", ["a", "icon set"], '(tag:a OR tag:"icon set")'],
  ])("writes %s", (_case, values, expected) => {
    expect(orGroup("tag", values)).toBe(expected);
  });
});

describe("nameTerm", () => {
  it("treats whitespace-only text as no term at all", () => {
    expect(nameTerm("   ")).toBe("");
  });

  it("keeps a trailing space, quoted, while the user is still typing", () => {
    expect(nameTerm("foo ")).toBe('name:"foo "');
  });

  it("keeps a leading space, quoted", () => {
    expect(nameTerm(" foo")).toBe('name:" foo"');
  });
});

describe("joinTerms", () => {
  it("joins the terms with spaces, leaving out empty ones", () => {
    expect(joinTerms(["name:a", "", "tag:b"])).toBe("name:a tag:b");
    expect(joinTerms(["", ""])).toBe("");
  });
});

describe("readTerms", () => {
  it("reads each known field's value in order, unquoted, inside OR groups too", () => {
    expect(readTerms('name:"foo " (tag:a OR tag:"icon set") deprecated:true', ["name", "tag", "deprecated"])).toEqual([
      { field: "name", value: "foo " },
      { field: "tag", value: "a" },
      { field: "tag", value: "icon set" },
      { field: "deprecated", value: "true" },
    ]);
  });

  it("matches fields case-insensitively and gives them back lower-case", () => {
    expect(readTerms("Tag:ds", ["tag"])).toEqual([{ field: "tag", value: "ds" }]);
  });

  it("skips fields it isn't asked for, and empty values", () => {
    expect(readTerms('usages:>=100 tag:"" name:x', ["name", "tag"])).toEqual([{ field: "name", value: "x" }]);
  });

  it("reads back what term writes", () => {
    for (const value of ["button", "@scope/pkg", "icon set", "foo ", " foo"]) {
      expect(readTerms(term("name", value), ["name"])).toEqual([{ field: "name", value }]);
    }
  });
});
