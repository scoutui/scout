/**
 * The Content-Security-Policy the middleware sends with every page.
 *
 * Scripts need the request's nonce: Next.js adds it to its own scripts when it
 * finds this policy on the request, and the root layout adds it to the theme
 * script. `'strict-dynamic'` lets those scripts load the app's chunks. Styles
 * allow `'unsafe-inline'` because charts and tag colours set `style`
 * attributes, which a nonce can't cover.
 *
 * Development adds `'unsafe-eval'`, which React needs to show errors in the
 * browser.
 */
export function contentSecurityPolicy(nonce: string, opts: { dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** A fresh nonce for one request. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
