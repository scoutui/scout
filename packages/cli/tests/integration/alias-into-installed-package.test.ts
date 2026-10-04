/**
 * alias-into-installed-package fixture, scanned from `app/`: `app/tsconfig.json`
 * maps `@ds`, `dsx` and `@ds/ui` to the entry file of the installed
 * `@example/react-ds`, and `@shared` to `shared/Button.js`, a file outside the
 * scanned project that no installed package holds. `app/src/App.tsx` renders
 * `Button` through each alias.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("alias-into-installed-package", { cwd: "app" }));
}, 30_000);

describe("integration: alias-into-installed-package fixture", () => {
  it("credits a path alias into an installed package to that package's export, whatever the alias's shape", () => {
    const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
    const button = { kind: "package-export", packageName: "@example/react-ds", publicEntry: "", exportName: "Button" };
    expect(
      out.occurrences.map((o) => ({
        at: `${o.filePath}:${o.line}:${o.column}`,
        component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
        trace: o.trace,
      })),
    ).toEqual([
      { at: "app/src/App.tsx:9:6", component: button, trace: [{ kind: "import", specifier: "@ds", name: "Button" }] },
      { at: "app/src/App.tsx:10:6", component: button, trace: [{ kind: "import", specifier: "dsx", name: "Button" }] },
      { at: "app/src/App.tsx:11:6", component: button, trace: [{ kind: "import", specifier: "@ds/ui", name: "Button" }] },
      {
        at: "app/src/App.tsx:12:6",
        component: { status: "unresolved", reason: { kind: "module-not-found" } },
        trace: [{ kind: "import", specifier: "@shared", name: "Button" }],
      },
    ]);
  });
});
