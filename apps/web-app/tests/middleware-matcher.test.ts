import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A path the matcher excludes is served with no session check, so the matcher
// is an authorisation boundary.
//
// Read from source rather than imported: Next.js statically analyses
// `config.matcher`, so it must be an inline literal in middleware.ts, and
// importing that module pulls in next-auth, which does not resolve under vitest.
const source = readFileSync(join(__dirname, "../src/middleware.ts"), "utf8");
const found = source.match(/matcher:\s*\["([^"]+)"\]/);
if (!found?.[1]) throw new Error("could not find the matcher literal in src/middleware.ts");
const MIDDLEWARE_MATCHER = found[1].replace(/\\\\/g, "\\");

const gated = (path: string) => new RegExp(`^${MIDDLEWARE_MATCHER}$`).test(path);

describe("middleware matcher", () => {
  it("gates repo paths whose id contains a dot", () => {
    // Repo ids come from git remotes, so dots are routine. A `.*\..*` exclusion
    // (the usual Next.js skip-static-files idiom) would serve these anonymously.
    expect(gated("/repos/example.app%2Fweb")).toBe(true);
    expect(gated("/repos/example.app/web")).toBe(true);
    expect(gated("/api/repos/example.app%2Fweb")).toBe(true);
    expect(gated("/repos/my-org.github.io")).toBe(true);
    expect(gated("/components/Button.v2")).toBe(true);
  });

  it("gates ordinary application paths", () => {
    for (const p of ["/", "/repos", "/repos/shop-web", "/charts", "/governance", "/packages", "/api/repos"]) {
      expect(gated(p), p).toBe(true);
    }
  });

  it("leaves the auth flow, CLI ingestion and static assets ungated", () => {
    // These are gated elsewhere or must be reachable anonymously: the OIDC flow
    // itself, bearer-token CLI upload, and the assets the login page renders with.
    expect(gated("/api/auth/signin")).toBe(false);
    expect(gated("/api/auth/callback/oidc")).toBe(false);
    expect(gated("/api/scans")).toBe(false);
    expect(gated("/api/scans/uploads/00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(gated("/_next/static/chunks/main.js")).toBe(false);
    expect(gated("/_next/static/media/monaspace-neon-latin-400-normal.woff2")).toBe(false);
    expect(gated("/_next/image")).toBe(false);
    expect(gated("/favicon.ico")).toBe(false);
    expect(gated("/icon.svg")).toBe(false);
  });

  it("leaves exactly /api/health ungated for the kubelet", () => {
    // The chart's liveness and readiness probes hit this path with no session.
    expect(gated("/api/health")).toBe(false);
  });

  it("gates paths that merely start with the health prefix", () => {
    // `api/health` is anchored with `$`, so the exclusion cannot widen into a
    // route that shares its prefix.
    expect(gated("/api/healthy")).toBe(true);
    expect(gated("/api/health/secrets")).toBe(true);
    expect(gated("/api/healthcheck")).toBe(true);
    expect(gated("/api/health-data")).toBe(true);
  });

  it("gates paths that merely start with the icon.svg prefix", () => {
    // `icon\\.svg` is anchored with `$`, so the exclusion cannot widen into a
    // route that shares its prefix.
    expect(gated("/icon.svgx")).toBe(true);
  });
});
