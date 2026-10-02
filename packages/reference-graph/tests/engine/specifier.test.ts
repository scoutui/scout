import { describe, it, expect } from "vitest";
import { externalSubpath } from "../../src/engine/specifier.js";

describe("externalSubpath: publicEntry derivation from an import specifier", () => {
  it("returns the subpath after the package name", () => {
    expect(externalSubpath("@scope/pkg", "@scope/pkg/react/button")).toBe("react/button");
  });

  it("strips a trailing .js module extension so spelling variants collapse", () => {
    // `@x/webc/react/button` and `@x/webc/react/button.js` resolve to the same
    // module, so they get the same component id.
    expect(externalSubpath("@example/webc", "@example/webc/react/button.js")).toBe(
      "react/button",
    );
  });

  it("derives an identical subpath whether or not the specifier carries an extension", () => {
    const withExt = externalSubpath("@example/webc", "@example/webc/react/button.js");
    const without = externalSubpath("@example/webc", "@example/webc/react/button");
    expect(withExt).toBe(without);
  });

  it("strips .mjs / .cjs / .jsx / .ts / .tsx / .vue extensions too", () => {
    expect(externalSubpath("p", "p/a.mjs")).toBe("a");
    expect(externalSubpath("p", "p/a.cjs")).toBe("a");
    expect(externalSubpath("p", "p/a.jsx")).toBe("a");
    expect(externalSubpath("p", "p/a.ts")).toBe("a");
    expect(externalSubpath("p", "p/a.tsx")).toBe("a");
    expect(externalSubpath("p", "p/a.vue")).toBe("a");
  });

  it("leaves non-module extensions (e.g. .css, .json) intact", () => {
    expect(externalSubpath("@x/pkg", "@x/pkg/styles/button.css")).toBe("styles/button.css");
    expect(externalSubpath("@x/pkg", "@x/pkg/data.json")).toBe("data.json");
  });

  it("returns undefined for a bare package specifier", () => {
    expect(externalSubpath("react", "react")).toBeUndefined();
    expect(externalSubpath("@org/pkg", "@org/pkg")).toBeUndefined();
  });

  it("does not strip an extension-looking segment that is not the trailing module extension", () => {
    // `.5` is not a module extension: the dot belongs to a version-like segment.
    expect(externalSubpath("@x/pkg", "@x/pkg/v2.5/button")).toBe("v2.5/button");
  });
});
