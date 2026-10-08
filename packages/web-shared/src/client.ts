// Client-safe entry point: re-exports only the pure, driver-free modules.
// The package barrel ("@scoutui/web-shared") re-exports the Postgres driver,
// so importing any value from it pulls pg/fs/net/tls into a client bundle.
// Type-only imports from the barrel are erased and safe, but `"use client"`
// modules that need a runtime helper (resolveTags, …) must import it from here.
export * from "./dto.js";
export * from "./cohorts.js";
export * from "./dashboard-render.js";
export * from "./chart-range.js";
export * from "./query.js";
export * from "./tags.js";
export * from "./governance.js";
export * from "./governance-integrity.js";
export * from "./usage.js";
export * from "./usage-view.js";
export * from "./scan-diff.js";
