import { describe, expect, it } from "vitest";
import { parseRepoQuery, serializeRepoQuery, type RepoQuery } from "@/lib/repo-query";
import { queryString } from "@/lib/query-string";

describe("repos list URL params", () => {
  it.each<[string, RepoQuery, string]>([
    ["search text", { text: "acme", changed: false }, "q=acme"],
    ["search text with a trailing space", { text: "acme ", changed: false }, "q=acme+"],
    ["changed since the previous scan", { text: "", changed: true }, "changed=true"],
    ["both", { text: "acme", changed: true }, "q=acme&changed=true"],
    ["neither", { text: "", changed: false }, ""],
  ])("writes and reads %s", (_case, query, written) => {
    expect(queryString(serializeRepoQuery(query))).toBe(written);
    expect(parseRepoQuery(new URLSearchParams(written))).toEqual(query);
  });

  it("keeps search text that looks like a filter as text", () => {
    expect(parseRepoQuery(new URLSearchParams("q=acme+changed:true"))).toEqual({ text: "acme changed:true", changed: false });
  });
});
