import { describe, expect, it } from "vitest";
import { parseRepoQuery, serializeRepoQuery } from "@/lib/repo-query";

describe("repo ?q= with a leading changed:true token", () => {
  it("round-trips text, the token, and both together, keeping trailing spaces", () => {
    for (const q of ["", "acme", "acme ", "changed:true", "changed:true acme", "changed:true acme "]) {
      expect(serializeRepoQuery(parseRepoQuery(q))).toBe(q);
    }
    expect(parseRepoQuery("changed:true")).toEqual({ text: "", changed: true });
    expect(parseRepoQuery("changed:true acme ")).toEqual({ text: "acme ", changed: true });
    expect(parseRepoQuery("acme")).toEqual({ text: "acme", changed: false });
  });

  it("does not treat the token mid-text as a filter", () => {
    expect(parseRepoQuery("acme changed:true")).toEqual({ text: "acme changed:true", changed: false });
  });
});
