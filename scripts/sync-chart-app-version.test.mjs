import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./sync-chart-app-version.mjs", import.meta.url));
const dirs = [];

/** Runs the script in a repository holding only the web app's version and the chart. */
function sync({ chartVersion, chartAppVersion, webAppVersion }) {
  const root = mkdtempSync(join(tmpdir(), "sync-chart-"));
  dirs.push(root);
  mkdirSync(join(root, "apps/web-app"), { recursive: true });
  mkdirSync(join(root, "charts/scout"), { recursive: true });
  writeFileSync(join(root, "apps/web-app/package.json"), JSON.stringify({ version: webAppVersion }));
  writeFileSync(join(root, "charts/scout/Chart.yaml"), `name: scout\nversion: ${chartVersion}\nappVersion: "${chartAppVersion}"\n`);
  writeFileSync(join(root, "charts/scout/CHANGELOG.md"), `# scout chart\n\n## ${chartVersion}\n\n- Earlier entry.\n`);
  const { status } = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
  const chart = readFileSync(join(root, "charts/scout/Chart.yaml"), "utf8");
  const changelog = readFileSync(join(root, "charts/scout/CHANGELOG.md"), "utf8");
  return {
    status,
    version: chart.match(/^version: (.*)$/m)?.[1],
    appVersion: chart.match(/^appVersion: "(.*)"$/m)?.[1],
    newestEntry: changelog.match(/^## (.*)$/m)?.[1],
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("sync-chart-app-version", () => {
  it.each([
    ["a patch release raises the chart's patch version", "0.1.14", "0.1.0", "0.1.1", "0.1.15"],
    ["a minor release raises the chart's minor version", "0.1.14", "0.1.0", "0.2.0", "0.2.0"],
    ["a major release raises the chart's major version", "0.1.14", "0.9.0", "1.0.0", "1.0.0"],
    ["an appVersion that isn't a version gets a patch release", "0.1.14", "main", "0.1.1", "0.1.15"],
  ])("%s", (_title, chartVersion, chartAppVersion, webAppVersion, expected) => {
    const result = sync({ chartVersion, chartAppVersion, webAppVersion });
    expect(result).toEqual({ status: 0, version: expected, appVersion: webAppVersion, newestEntry: expected });
  });

  it("leaves the chart alone when it already runs the web app's version", () => {
    const result = sync({ chartVersion: "0.1.14", chartAppVersion: "0.1.1", webAppVersion: "0.1.1" });
    expect(result).toEqual({ status: 0, version: "0.1.14", appVersion: "0.1.1", newestEntry: "0.1.14" });
  });

  it("fails without changing the chart when its version isn't like 1.2.3", () => {
    const result = sync({ chartVersion: "0.1", chartAppVersion: "0.1.0", webAppVersion: "0.1.1" });
    expect(result).toEqual({ status: 1, version: "0.1", appVersion: "0.1.0", newestEntry: "0.1" });
  });
});
