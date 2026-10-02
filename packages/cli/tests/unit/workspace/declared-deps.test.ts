import { describe, it, expect } from "vitest";
import { createDeclaredDependencyTest } from "../../../src/workspace/declared-deps.js";
import type { WorkspaceGraph } from "../../../src/workspace/types.js";

const graph = (overrides: Partial<WorkspaceGraph> = {}): WorkspaceGraph => ({
  packageManager: "yarn",
  rootPath: "/x",
  rootPackageName: "root",
  packages: [],
  ...overrides,
});

describe("createDeclaredDependencyTest", () => {
  const web = (dependencies: Record<string, string> = {}) =>
    graph({ packages: [{ name: "web", absolutePath: "/x/apps/web", packageJson: { name: "web", dependencies } }] });

  it("answers the root package.json for a member file when the root declares the package", () => {
    const declaredIn = createDeclaredDependencyTest(web(), (path) =>
      path === "/x/package.json" ? { devDependencies: { "@example/ui": "*" } } : null,
    );
    expect(declaredIn("/x/apps/web/src/App.tsx", "@example/ui")).toBe("/x/package.json");
    expect(declaredIn("/x/apps/web/src/App.tsx", "left-pad-ui")).toBeNull();
  });

  it("answers the owning member's package.json when only that member declares the package", () => {
    const declaredIn = createDeclaredDependencyTest(web({ "@example/ui": "*" }), () => null);
    expect(declaredIn("/x/apps/web/src/App.tsx", "@example/ui")).toBe("/x/apps/web/package.json");
    expect(declaredIn("/x/src/Root.tsx", "@example/ui")).toBeNull();
  });

  it("counts a package declared only as a peer or only as an optional dependency", () => {
    const declaredIn = createDeclaredDependencyTest(web(), (path) =>
      path === "/x/package.json"
        ? { peerDependencies: { "@example/peer-ui": "*" }, optionalDependencies: { "@example/optional-ui": "*" } }
        : null,
    );
    expect(declaredIn("/x/apps/web/src/App.tsx", "@example/peer-ui")).toBe("/x/package.json");
    expect(declaredIn("/x/apps/web/src/App.tsx", "@example/optional-ui")).toBe("/x/package.json");
  });
});
