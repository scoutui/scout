import { describe, expect, it } from "vitest";
import { componentKey } from "../src/component-key.js";

const pe = (packageName: string, publicEntry: string, exportName: string) =>
  ({ kind: "package-export", packageName, publicEntry, exportName }) as const;
const rd = (repoId: string, filePath: string, exportName: string) =>
  ({ kind: "repository-declaration", repoId, filePath, exportName }) as const;

describe("componentKey", () => {
  it("keeps same-named exports at different public entries distinct", () => {
    const ids = ["dist/react/button/index", "dist/react/card/index", "dist/react/input/index"]
      .map((e) => componentKey(pe("@example/kit", e, "default")));
    expect(new Set(ids).size).toBe(3);
  });
  it("distinguishes the root entry from a subpath", () => {
    expect(componentKey(pe("@example/kit", "", "X"))).not.toBe(componentKey(pe("@example/kit", "x", "X")));
  });
  it("includes the repository in a repository declaration's key", () => {
    expect(componentKey(rd("repo-a", "src/A.tsx", "A"))).not.toBe(componentKey(rd("repo-b", "src/A.tsx", "A")));
  });
  it("keeps different exports and different declaration files distinct", () => {
    expect(componentKey(pe("@example/kit", "", "A"))).not.toBe(componentKey(pe("@example/kit", "", "B")));
    expect(componentKey(rd("r", "src/A.tsx", "A"))).not.toBe(componentKey(rd("r", "src/B.tsx", "A")));
    expect(componentKey(rd("r", "src/A.tsx", "A"))).not.toBe(componentKey(rd("r", "src/A.tsx", "B")));
  });
  it("keys a tag by its name alone", () => {
    expect(componentKey({ kind: "tag", tagName: "x-card" })).toBe(componentKey({ kind: "tag", tagName: "x-card" }));
    expect(componentKey({ kind: "tag", tagName: "x-card" })).not.toBe(componentKey({ kind: "tag", tagName: "x-cards" }));
  });
  it("does not collide across variants or through separators in values", () => {
    expect(componentKey(pe("a", "b", "c"))).not.toBe(componentKey(rd("a", "b", "c")));
    expect(componentKey(pe("a", "b::c", "d"))).not.toBe(componentKey(pe("a", "b", "c::d")));
    expect(componentKey(pe("a", 'b","c', "d"))).not.toBe(componentKey(pe("a", "b", 'c","d')));
  });
  it("returns 16 lowercase hex characters", () => {
    expect(componentKey({ kind: "tag", tagName: "x-a" })).toMatch(/^[0-9a-f]{16}$/);
  });
});
