#!/usr/bin/env node
// Point the Helm chart at the web app's current version.
// Usage: node scripts/sync-chart-app-version.mjs (from the repository root)
//
// When apps/web-app/package.json has a version the chart's appVersion doesn't
// match, sets appVersion to it, bumps the chart's patch version and adds a
// CHANGELOG entry, so every web app release is also a chart release. Does
// nothing when they already match.

import { readFileSync, writeFileSync } from "node:fs";

const CHART = "charts/scout/Chart.yaml";
const CHANGELOG = "charts/scout/CHANGELOG.md";

const appVersion = JSON.parse(readFileSync("apps/web-app/package.json", "utf8")).version;
const chart = readFileSync(CHART, "utf8");

if (chart.match(/^appVersion: "(.*)"$/m)?.[1] === appVersion) process.exit(0);

const current = chart.match(/^version: (\d+)\.(\d+)\.(\d+)$/m);
if (!current) {
  console.error(`${CHART} needs a version like 1.2.3 before its patch number can be bumped.`);
  process.exit(1);
}
const [, major, minor, patch] = current;
const version = `${major}.${minor}.${Number(patch) + 1}`;

writeFileSync(
  CHART,
  chart
    .replace(/^version: .*$/m, `version: ${version}`)
    .replace(/^appVersion: .*$/m, `appVersion: "${appVersion}"`),
);
writeFileSync(
  CHANGELOG,
  readFileSync(CHANGELOG, "utf8").replace(
    /^## /m,
    `## ${version}\n\n- Run web app ${appVersion} by default.\n\n## `,
  ),
);
console.log(`Chart ${version} now runs web app ${appVersion}.`);
