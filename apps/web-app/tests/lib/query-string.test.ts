import { describe, expect, it } from "vitest";
import { hrefWithQuery, queryString } from "@/lib/query-string";

describe("queryString", () => {
  it.each([
    ["a colon, an at sign and a slash as typed", "@acme/ui:core", "@acme/ui:core"],
    ["a question mark, comma and semicolon as typed", "a?b,c;d", "a?b,c;d"],
    ["a space as +", "date picker", "date+picker"],
    ["an ampersand encoded", "a&b", "a%26b"],
    ["a hash encoded", "a#b", "a%23b"],
    ["a plus encoded", "c++", "c%2B%2B"],
    ["a percent sign encoded", "100%", "100%25"],
    ["an equals sign encoded", "a=b", "a%3Db"],
    ["a double quote encoded", 'say "hi"', "say+%22hi%22"],
    ["angle brackets encoded", "<b>", "%3Cb%3E"],
    ["non-ASCII encoded", "café", "caf%C3%A9"],
  ])("writes %s", (_case, value, written) => {
    expect(queryString([["v", value]])).toBe(`v=${written}`);
  });

  it("joins params in order, repeating a name for each value", () => {
    expect(queryString([["tag", "icons"], ["tag", "acme-ui"], ["deprecated", "true"]])).toBe("tag=icons&tag=acme-ui&deprecated=true");
  });

  it("reads back what it writes", () => {
    const value = '@acme/ui:core a&b#c+d%e=f "g" café';
    expect(new URLSearchParams(queryString([["v", value]])).get("v")).toBe(value);
  });

  it("adds the query to a path only when there is one", () => {
    expect(hrefWithQuery("/packages", [["deprecated", "true"]])).toBe("/packages?deprecated=true");
    expect(hrefWithQuery("/packages", [])).toBe("/packages");
  });
});
