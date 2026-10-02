import { describe, expect, it } from "vitest";
import { parseGitRemote } from "../src/git-remote.js";

describe("parseGitRemote", () => {
  it("parses public HTTPS form with .git suffix", () => {
    expect(parseGitRemote("https://github.com/example-org/example.app.git")).toEqual({
      host: "github.com",
      path: "example-org/example.app",
      display: "github.com/example-org/example.app",
      href: "https://github.com/example-org/example.app",
    });
  });

  it("parses public HTTPS form without .git suffix", () => {
    expect(parseGitRemote("https://github.com/ExampleOrg/ExampleClients")).toEqual({
      host: "github.com",
      path: "ExampleOrg/ExampleClients",
      display: "github.com/ExampleOrg/ExampleClients",
      href: "https://github.com/ExampleOrg/ExampleClients",
    });
  });

  it("parses SSH form with .git suffix", () => {
    expect(parseGitRemote("git@github.com:example-org/example.app.git")).toEqual({
      host: "github.com",
      path: "example-org/example.app",
      display: "github.com/example-org/example.app",
      href: "https://github.com/example-org/example.app",
    });
  });

  it("parses SSH form without .git suffix", () => {
    expect(parseGitRemote("git@github.example.com:web/example-web")).toEqual({
      host: "github.example.com",
      path: "web/example-web",
      display: "github.example.com/web/example-web",
      href: "https://github.example.com/web/example-web",
    });
  });

  it("normalizes HTTPS and SSH forms to the same shape", () => {
    const https = parseGitRemote("https://github.com/example-org/example.app.git");
    const ssh = parseGitRemote("git@github.com:example-org/example.app.git");
    expect(https).toEqual(ssh);
  });

  it.each([
    "ssh://git@github.com/example-org/example.app.git",
    "ssh://git@github.com:2222/example-org/example.app.git",
    "ssh://git@github.com/example-org/example.app",
    "ssh://github.com/example-org/example.app.git",
  ])("parses the ssh:// form %s to its HTTPS shape", remote => {
    expect(parseGitRemote(remote)).toEqual({
      host: "github.com",
      path: "example-org/example.app",
      display: "github.com/example-org/example.app",
      href: "https://github.com/example-org/example.app",
    });
  });

  const bitbucketShopWeb = { host: "bitbucket.example.com", path: "shop/web" };
  const bitbucketPersonal = { host: "bitbucket.example.com", path: "~alex/notes" };
  const azureShopWeb = { host: "dev.azure.com", path: "acme/shop/_git/web" };

  it.each([
    ["https://bitbucket.example.com/scm/shop/web.git", bitbucketShopWeb, "https://bitbucket.example.com/projects/shop/repos/web"],
    ["https://bitbucket.example.com/bitbucket/scm/shop/web.git", bitbucketShopWeb, "https://bitbucket.example.com/bitbucket/projects/shop/repos/web"],
    ["ssh://git@bitbucket.example.com:7999/shop/web.git", bitbucketShopWeb, "https://bitbucket.example.com/shop/web"],
    ["git@bitbucket.example.com:shop/web.git", bitbucketShopWeb, "https://bitbucket.example.com/shop/web"],
    ["https://bitbucket.example.com/scm/~alex/notes.git", bitbucketPersonal, "https://bitbucket.example.com/users/alex/repos/notes"],
    ["ssh://git@bitbucket.example.com:7999/~alex/notes.git", bitbucketPersonal, "https://bitbucket.example.com/~alex/notes"],
    ["https://dev.azure.com/acme/shop/_git/web", azureShopWeb, "https://dev.azure.com/acme/shop/_git/web"],
    ["https://acme@dev.azure.com/acme/shop/_git/web", azureShopWeb, "https://dev.azure.com/acme/shop/_git/web"],
    ["git@ssh.dev.azure.com:v3/acme/shop/web", azureShopWeb, "https://dev.azure.com/acme/shop/_git/web"],
    ["ssh://git@ssh.dev.azure.com/v3/acme/shop/web", azureShopWeb, "https://dev.azure.com/acme/shop/_git/web"],
    ["https://acme.visualstudio.com/shop/_git/web", azureShopWeb, "https://dev.azure.com/acme/shop/_git/web"],
    ["acme@vs-ssh.visualstudio.com:v3/acme/shop/web", azureShopWeb, "https://dev.azure.com/acme/shop/_git/web"],
  ])("reads %s as its repository's HTTPS host and path, whichever form it is", (remote, { host, path }, href) => {
    expect(parseGitRemote(remote)).toEqual({ host, path, display: `${host}/${path}`, href });
  });

  it.each([
    ["https://github.com/scm/tools.git", "github.com/scm/tools"],
    ["https://gitlab.example.com/acme/scm/tools/app/web.git", "gitlab.example.com/acme/scm/tools/app/web"],
  ])("keeps scm in %s, where it isn't followed by exactly a project and a repository", (remote, display) => {
    expect(parseGitRemote(remote)?.display).toBe(display);
  });

  it("parses the scp form with an SSH user other than git", () => {
    expect(parseGitRemote("gitea@git.example.com:team/app.git")).toEqual({
      host: "git.example.com",
      path: "team/app",
      display: "git.example.com/team/app",
      href: "https://git.example.com/team/app",
    });
  });

  it("handles gitlab-style subgroup paths", () => {
    expect(parseGitRemote("git@gitlab.com:group/subgroup/repo.git")).toEqual({
      host: "gitlab.com",
      path: "group/subgroup/repo",
      display: "gitlab.com/group/subgroup/repo",
      href: "https://gitlab.com/group/subgroup/repo",
    });
  });

  it("strips trailing slashes", () => {
    expect(parseGitRemote("https://github.com/example-org/example.app/")?.display).toBe(
      "github.com/example-org/example.app",
    );
  });

  it("trims leading whitespace", () => {
    expect(parseGitRemote("  https://github.com/example-org/example.app  ")?.display).toBe(
      "github.com/example-org/example.app",
    );
  });

  it("returns null for null / undefined / empty input", () => {
    expect(parseGitRemote(null)).toBeNull();
    expect(parseGitRemote(undefined)).toBeNull();
    expect(parseGitRemote("")).toBeNull();
    expect(parseGitRemote("   ")).toBeNull();
  });

  it("returns null for unparseable strings", () => {
    expect(parseGitRemote("not a git remote")).toBeNull();
    expect(parseGitRemote("ftp://example.com/foo.git")).toBeNull();
    expect(parseGitRemote("https://github.com")).toBeNull(); // no path
    expect(parseGitRemote("git@github.com")).toBeNull(); // no colon, no path
  });

  it("strips userinfo (user:pass@) from HTTPS hosts so credentials never leak", () => {
    const parsed = parseGitRemote("https://x-access-token:GHP_FAKE@github.com/example-org/example.app.git");
    expect(parsed).toEqual({
      host: "github.com",
      path: "example-org/example.app",
      display: "github.com/example-org/example.app",
      href: "https://github.com/example-org/example.app",
    });
    const flat = JSON.stringify(parsed);
    expect(flat).not.toContain("GHP_FAKE");
    expect(flat).not.toContain("x-access-token");
  });

  it("strips user:token@ userinfo from ssh:// remotes so credentials never leak", () => {
    const parsed = parseGitRemote("ssh://user:token@github.com/example-org/example.app.git");
    expect(parsed).toEqual({
      host: "github.com",
      path: "example-org/example.app",
      display: "github.com/example-org/example.app",
      href: "https://github.com/example-org/example.app",
    });
    const flat = JSON.stringify(parsed);
    expect(flat).not.toContain("user");
    expect(flat).not.toContain("token");
  });

  it("strips bare user@ userinfo from HTTPS hosts", () => {
    expect(parseGitRemote("https://user@github.com/example-org/example.app.git")?.display).toBe(
      "github.com/example-org/example.app",
    );
  });

  it("rejects scp-shorthand SSH with embedded port (git@host:22:path)", () => {
    expect(parseGitRemote("git@github.com:22:example-org/example.app.git")).toBeNull();
  });

  it("rejects inputs with embedded whitespace", () => {
    expect(parseGitRemote("git@github.com:org/repo with spaces.git")).toBeNull();
    expect(parseGitRemote("https://github.com/org/repo with spaces")).toBeNull();
  });
});
