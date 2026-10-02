import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

// Each subpath entry of one package is a component of its own.
//
// `@example/shoelace` ships its React wrappers as subpath entries,
// `@example/shoelace/dist/react/button/index.js`, `…/input/index.js` and
// `…/card/index.js`, with no `exports` field and no barrel the scanner can
// trace them through, as Shoelace does. Without `publicEntry` in the identity
// all three imports would collapse into one `@example/shoelace` component and
// share their props.

describe("integration: subpath-entries fixture (publicEntry disambiguation)", () => {
  let scan: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: scan } = await scanFixture("subpath-entries", { args: ["--quiet"] }));
  }, 30_000);

  const shoelaceExports = () =>
    scan.components.flatMap((c) =>
      c.identity.kind === "package-export" && c.identity.packageName === "@example/shoelace"
        ? [{ component: c, publicEntry: c.identity.publicEntry }]
        : [],
    );

  it("produces distinct components for each subpath import", () => {
    const shoelaceComponents = shoelaceExports();

    // 3 distinct package-export identities, one per subpath
    expect(shoelaceComponents).toHaveLength(3);
    expect(new Set(shoelaceComponents.map(({ component }) => component.id)).size).toBe(3);

    const publicEntries = shoelaceComponents.map(({ publicEntry }) => publicEntry).sort();
    // publicEntry strips the module extension; the three subpaths stay
    // distinct.
    expect(publicEntries).toEqual([
      "dist/react/button/index",
      "dist/react/card/index",
      "dist/react/input/index",
    ]);
  });

  it("isolates prop distributions per component (no cross-bleed)", () => {
    const shoelaceComponents = shoelaceExports();

    const button = shoelaceComponents.find(({ publicEntry }) => publicEntry === "dist/react/button/index")?.component;
    const input = shoelaceComponents.find(({ publicEntry }) => publicEntry === "dist/react/input/index")?.component;

    expect(button?.props.variant).toBeDefined();
    expect(button?.props.size).toBeDefined();
    // `label` exists only on FakeInput, not on FakeButton.
    expect(button?.props.label).toBeUndefined();
    expect(input?.props.label).toBeDefined();
  });
});
