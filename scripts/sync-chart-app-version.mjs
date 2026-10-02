#!/usr/bin/env node
// Point the Helm chart at the web app's current version.
// Usage: node scripts/sync-chart-app-version.mjs (from the repository root)
//
// When apps/web-app/package.json has a version the chart's appVersion doesn't
// match, sets appVersion to it, raises the chart's version by the same step
// (major, minor or patch) as the web app's, and adds a CHANGELOG entry, so
// every web app release is also a chart release. Does nothing when they
// already match.

import { readFileSync, writeFileSync } from "node:fs";

const CHART = "charts/scout/Chart.yaml";
const CHANGELOG = "charts/scout/CHANGELOG.md";

const appVersion = JSON.parse(readFileSync("apps/web-app/package.json", "utf8")).version;
const chart = readFileSync(CHART, "utf8");

const previousAppVersion = chart.match(/^appVersion: "(.*)"$/m)?.[1];
if (previousAppVersion === appVersion) process.exit(0);

const current = chart.match(/^version: (\d+)\.(\d+)\.(\d+)$/m);
if (!current) {
  console.error(`${CHART} needs a version like 1.2.3 before it can be raised.`);
  process.exit(1);
}
const [major, minor, patch] = current.slice(1).map(Number);

/** The web app's step from `from` to `to`: "major", "minor", or "patch" when either isn't like 1.2.3. */
function step(from, to) {
  const parse = (v) => v?.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return "patch";
  if (a[0] !== b[0]) return "major";
  if (a[1] !== b[1]) return "minor";
  return "patch";
}

const version = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[step(previousAppVersion, appVersion)];

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
