import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/helpers/template-db.ts"],
    // next-auth imports `next/server`, and Next's package.json has no `exports`
    // field, so Node's ESM resolver can't resolve the extensionless path and an
    // externalised next-auth fails to load. Inlining it hands the import to
    // Vite's resolver instead.
    server: { deps: { inline: ["next-auth"] } },
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
