import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    globalSetup: ["../../apps/web-app/tests/helpers/template-db.ts"],
  },
});
