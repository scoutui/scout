import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    url: process.env["DATABASE_URL"] ?? "postgres://scout:scout@localhost:5432/scout",
  },
});
