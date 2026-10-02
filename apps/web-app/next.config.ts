import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't advertise the framework in an X-Powered-By response header.
  poweredByHeader: false,
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  // Next traces sharp (and its libvips binaries) for its image optimizer. The
  // dashboard uses no next/image, so the image ships without them.
  outputFileTracingExcludes: {
    "*": ["**/node_modules/sharp/**", "**/node_modules/@img/**"],
  },
  eslint: {
    // Biome lints; skip Next.js build-time linting.
    ignoreDuringBuilds: true,
  },
  // The Content-Security-Policy needs a nonce per request, so the middleware
  // sets it (src/lib/content-security-policy.ts), not these static headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The app renders repo names, file paths, component and prop values
          // read out of scanned source. Nothing escapes that beyond React's own
          // escaping, so these are defence in depth over a real injection path.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // For browsers without CSP frame-ancestors, and for the paths the
          // middleware doesn't run on.
          { key: "X-Frame-Options", value: "DENY" },
          // Two years, subdomains included. No `preload`: that submits the
          // domain to a list browsers ship, which is hard to undo, so it is the
          // operator's call.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
