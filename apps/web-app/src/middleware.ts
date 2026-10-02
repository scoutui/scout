import type { NextAuthRequest } from "next-auth";
import { type NextFetchEvent, type NextMiddleware, NextResponse } from "next/server";
import { auth } from "@/auth";
import { contentSecurityPolicy, newNonce } from "@/lib/content-security-policy";

/**
 * Passes the request on with a fresh nonce and its Content-Security-Policy.
 * Next.js reads the policy from the request to put the nonce on its scripts,
 * and the root layout reads `x-nonce` for its own.
 */
function withContentSecurityPolicy(req: NextAuthRequest): NextResponse {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

// Annotated because the inferred type pulls in next-auth/lib/types and fails
// portability (TS2742).
//
// The handler takes (NextAuthRequest, NextFetchEvent) so auth() picks its
// NextAuthMiddleware overload over AppRouteHandlerFn: both accept a one-argument
// lambda, and the second argument tells them apart.
const middleware: NextMiddleware = auth(
  (req: NextAuthRequest, _event: NextFetchEvent) => {
    const { pathname } = req.nextUrl;

    // The login page is open to everyone, otherwise the redirect below loops.
    if (pathname === "/login") return withContentSecurityPolicy(req);

    if (!req.auth) {
      const loginUrl = new URL("/login", req.nextUrl.origin);
      const dest = req.nextUrl.pathname + req.nextUrl.search;
      // "/" already redirects to /repos, the default, so don't carry it.
      if (dest !== "/") loginUrl.searchParams.set("callbackUrl", dest);
      return Response.redirect(loginUrl);
    }

    // "/" opens the repo list. It redirects here so it stays a 307: the root
    // layout sends its frame before a page can redirect.
    if (pathname === "/") return Response.redirect(new URL("/repos", req.nextUrl.origin), 307);
    return withContentSecurityPolicy(req);
  },
);

export default middleware;

// The Edge runtime can't load `node:crypto`, which Drizzle and pg need through
// `@/auth`.
export const runtime = "nodejs";

// Match every path except:
//   /api/auth/*       the OIDC flow itself
//   /api/scans*       CLI ingestion and upload status (each route authenticates itself)
//   /api/health       kubelet probe target, exact match only
//   /_next/*          static assets, including the fonts the login page needs
//   /favicon.ico      favicon probe (legacy browsers)
//   /icon.svg         favicon (Next.js metadata route)
//
// `api/health` is anchored with `$` so it excludes exactly that path. The other
// prefixes are unanchored, so they also exclude anything sharing their prefix
// (`/api/scansomething`); a new exclusion should be anchored.
//
// There is no "anything containing a dot" clause for static files. It would
// match a dot inside a route parameter, and repo ids come from git remotes, so
// they often contain dots (`example.app/web`): `/repos/example.app%2Fweb` would
// skip the sign-in check. The prefixes above cover every asset the app serves;
// nothing is served from `public/`.
//
// Next.js statically analyses this object, so the pattern must be an inline
// literal, not an import. tests/middleware-matcher.test.ts reads the literal
// from this file.
export const config = {
  matcher: ["/((?!api/auth|api/scans|api/health$|_next/static|_next/image|favicon\\.ico|icon\\.svg$).*)"],
};
