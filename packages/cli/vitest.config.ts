import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    setupFiles: ["tests/setup/no-keychain.ts"],
    coverage: {
      provider: "v8",
      reporter: ["cobertura", "json"],
      reportOnFailure: true,
      include: ["src/**"],
    },
  },
});
