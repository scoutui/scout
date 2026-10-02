import { describe, expect, it } from "vitest";
import { commitUrl } from "@/lib/git-remote";

describe("commitUrl", () => {
  it("links a github.com commit under <href>/commit/<sha>", () => {
    expect(commitUrl("git@github.com:example-org/example.app.git", "abcdef1234")).toBe(
      "https://github.com/example-org/example.app/commit/abcdef1234",
    );
  });

  it("links a gitlab.com commit, subgroups included", () => {
    expect(commitUrl("https://gitlab.com/group/subgroup/repo.git", "0123456")).toBe(
      "https://gitlab.com/group/subgroup/repo/commit/0123456",
    );
  });

  it("links a self-hosted github/gitlab instance on a github./gitlab. host", () => {
    expect(commitUrl("git@github.example.com:web/example-web", "abc")).toBe(
      "https://github.example.com/web/example-web/commit/abc",
    );
    expect(commitUrl("https://gitlab.example.com/web/example-web.git", "abc")).toBe(
      "https://gitlab.example.com/web/example-web/commit/abc",
    );
  });

  it("returns null for an unknown host, an unparseable remote, and no remote", () => {
    expect(commitUrl("https://bitbucket.org/team/repo.git", "abc")).toBeNull();
    expect(commitUrl("https://code.example.com/team/repo.git", "abc")).toBeNull();
    expect(commitUrl("not a git remote", "abc")).toBeNull();
    expect(commitUrl(null, "abc")).toBeNull();
    expect(commitUrl(undefined, "abc")).toBeNull();
  });
});
