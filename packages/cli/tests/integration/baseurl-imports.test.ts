/**
 * Semantic gate for the baseurl-imports fixture. Under `"baseUrl": "."`
 * a bare `app/Banner` names the repository file `app/Banner.tsx`, not a
 * package called `app`.
 */
import { describe, it, expect } from "vitest";
import { scanFixture } from "../helpers/stage-fixture.js";

describe("integration: baseurl-imports fixture, bare specifiers under tsconfig baseUrl", () => {
  it("credits `app/Banner` to the repository declaration, not to a package called `app`", async () => {
    const { artifact: out } = await scanFixture("baseurl-imports", { args: ["--quiet"] });

    const banner = out.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Banner");
    expect(banner?.identity).toEqual({
      kind: "repository-declaration",
      repoId: "baseurl-imports",
      filePath: "app/Banner.tsx",
      exportName: "Banner",
    });

    const pageRenders = out.occurrences.filter((o) => o.filePath === "src/Page.tsx");
    expect(pageRenders.map((o) => o.resolution)).toEqual([{ status: "resolved", componentId: banner?.id }]);

    expect(out.components.filter((c) => c.identity.kind === "package-export" && c.identity.packageName === "app")).toEqual([]);
  }, 30_000);
});
