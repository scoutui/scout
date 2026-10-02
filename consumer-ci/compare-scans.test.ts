import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentKey, type Identity } from "@scoutui/scan-format";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const script = fileURLToPath(new URL("./compare-scans.sh", import.meta.url));

const button: Identity = { kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName: "Button" };
const card: Identity = { kind: "package-export", packageName: "@example/ui", publicEntry: "dist/card", exportName: "default" };
const panel: Identity = { kind: "repository-declaration", repoId: "example/app", filePath: "src/Panel.tsx", exportName: "Panel" };
const badge: Identity = { kind: "tag", tagName: "example-badge" };

const BUTTON = "package-export|@example/ui||Button";
const CARD = "package-export|@example/ui|dist/card|default";
const PANEL = "repository-declaration|example/app|src/Panel.tsx|Panel";
const BADGE = "tag|example-badge";

function position(site: string) {
  const [filePath, line, column] = site.split(":");
  return { filePath, line: Number(line), column: Number(column) };
}

/**
 * A scan file. `sites` maps `filePath:line:column` to the identity credited there, or to one
 * identity per occurrence at that site; `null` is a module that wasn't found.
 */
function scanFile(rows: Identity[], sites: Record<string, Identity | null | (Identity | null)[]>) {
  return {
    meta: { schemaVersion: 2, repo: { id: "example/app" } },
    components: rows.map((identity) => ({ id: componentKey(identity), identity })),
    occurrences: Object.entries(sites).flatMap(([site, credited]) =>
      (Array.isArray(credited) ? credited : [credited]).map((identity) => ({
        ...position(site),
        resolution:
          identity === null
            ? { status: "unresolved", reason: { kind: "module-not-found" } }
            : { status: "resolved", componentId: componentKey(identity) },
      })),
    ),
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compare-scans-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function compare(before: object, after: object, expectLines?: string[]) {
  writeFileSync(join(dir, "before.json"), JSON.stringify(before));
  writeFileSync(join(dir, "after.json"), JSON.stringify(after));
  const args = [script, join(dir, "before.json"), join(dir, "after.json")];
  if (expectLines) {
    writeFileSync(join(dir, "scan.expect"), `${expectLines.join("\n")}\n`);
    args.push("--expect", join(dir, "scan.expect"));
  }
  const run = spawnSync("bash", args, { encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("compare-scans.sh", () => {
  test("exits 1 when most rows are gone although every site keeps its identity", () => {
    const before = scanFile([button, card, panel, badge], { "src/App.tsx:3:5": button });
    const after = scanFile([button], { "src/App.tsx:3:5": button });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`lost-row ${CARD}`);
    expect(run.stdout).toContain(`lost-row ${PANEL}`);
    expect(run.stdout).toContain(`lost-row ${BADGE}`);
  });

  test("exits 1 when every site is re-attributed although every site and row survives", () => {
    const before = scanFile([button, panel], { "src/App.tsx:3:5": button, "src/App.tsx:4:5": panel, "src/App.tsx:5:5": panel });
    const after = scanFile([button, panel], { "src/App.tsx:3:5": panel, "src/App.tsx:4:5": button, "src/App.tsx:5:5": button });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`reattributed ${BUTTON} -> ${PANEL} 1\n`);
    expect(run.stdout).toContain(`reattributed ${PANEL} -> ${BUTTON} 2\n`);
  });

  test("exits 1 when one of a site's repeated credits moves to another component", () => {
    const before = scanFile([button, card], { "src/App.tsx:3:5": [button, button], "src/App.tsx:4:5": [button, card] });
    const after = scanFile([button, card], { "src/App.tsx:3:5": [button, card], "src/App.tsx:4:5": [button, button] });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`reattributed ${BUTTON} -> ${CARD} 1\n`);
    expect(run.stdout).toContain(`reattributed ${CARD} -> ${BUTTON} 1\n`);
  });

  test("exits 1 when a site credited twice to one component loses one credit", () => {
    const before = scanFile([button], { "src/App.tsx:3:5": [button, button] });
    const after = scanFile([button], { "src/App.tsx:3:5": button });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`reattributed ${BUTTON} -> (none) 1\n`);
  });

  test("exits 0 when a site keeps the same credits in a different order", () => {
    const before = scanFile([button, card], { "src/App.tsx:3:5": [button, card, button] });
    const after = scanFile([button, card], { "src/App.tsx:3:5": [card, button, button] });

    expect(compare(before, after).status).toBe(0);
  });

  test("exits 1 when repository declarations move to another repoId", () => {
    const moved: Identity = { ...panel, repoId: "example/other" };
    const before = scanFile([panel], { "src/App.tsx:3:5": panel });
    const after = scanFile([moved], { "src/App.tsx:3:5": moved });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`reattributed ${PANEL} -> repository-declaration|example/other|src/Panel.tsx|Panel 1`);
    expect(run.stdout).toContain(`lost-row ${PANEL}`);
  });

  test("exits 1 when a site is lost", () => {
    const before = scanFile([button], { "src/App.tsx:3:5": button, "src/App.tsx:4:5": button });
    const after = scanFile([button], { "src/App.tsx:3:5": button });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`lost-site src/App.tsx:4:5 ${BUTTON}`);
  });

  test("exits 1 when a resolved site becomes unresolved", () => {
    const before = scanFile([card], { "src/App.tsx:3:5": card });
    const after = scanFile([card], { "src/App.tsx:3:5": null });

    const run = compare(before, after);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`reattributed ${CARD} -> unresolved:module-not-found 1`);
  });

  test("exits 0 when AFTER only gains sites and rows", () => {
    const before = scanFile([button], { "src/App.tsx:3:5": button });
    const after = scanFile([button, card], { "src/App.tsx:3:5": button, "src/App.tsx:4:5": card, "src/App.tsx:5:5": null });

    expect(compare(before, after).status).toBe(0);
  });

  test("exits 0 when every difference is in the expect file, and reports unused and repeated lines", () => {
    const before = scanFile([button, card, panel], { "src/App.tsx:3:5": button, "src/App.tsx:4:5": card, "src/App.tsx:5:5": card });
    const after = scanFile([button, card], { "src/App.tsx:3:5": card });

    const run = compare(before, after, [
      "# the Button import now resolves to the card entry",
      `reattributed ${BUTTON} -> ${CARD} 1`,
      `lost-site src/App.tsx:4:5 ${CARD}`,
      "",
      `lost-site src/App.tsx:5:5 ${CARD}`,
      `lost-row ${PANEL}`,
      `lost-row ${BADGE}`,
      `lost-row ${PANEL}`,
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`7: lost-row ${BADGE}\n`);
    expect(run.stdout).toContain(`8: lost-row ${PANEL} (repeats line 6)\n`);
  });

  test("exits 1 when an expected re-attribution moved a different number of sites", () => {
    const before = scanFile([button, card], { "src/App.tsx:3:5": button, "src/App.tsx:4:5": button });
    const after = scanFile([button, card], { "src/App.tsx:3:5": card, "src/App.tsx:4:5": card });

    const run = compare(before, after, [`reattributed ${BUTTON} -> ${CARD} 1`]);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`reattributed ${BUTTON} -> ${CARD} 2`);
  });
});
