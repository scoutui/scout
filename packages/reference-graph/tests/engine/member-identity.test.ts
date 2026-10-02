import { describe, it, expect } from "vitest";
import { effectiveExportName, residualMemberChain, compoundExportName } from "../../src/engine/member-identity.js";

describe("member-chain seam", () => {
  it("a namespace import consumes the first segment as the root; the rest is residual", () => {
    expect(effectiveExportName("*", ["Root", "Foo"])).toBe("Root");
    expect(residualMemberChain("*", ["Root", "Foo"])).toEqual(["Foo"]);
    expect(residualMemberChain("*", ["Root"])).toEqual([]);
  });

  it("a named or default import keeps its name as the root; the whole chain is residual", () => {
    expect(effectiveExportName("Dialog", ["Popup"])).toBe("Dialog");
    expect(residualMemberChain("Dialog", ["Popup"])).toEqual(["Popup"]);
    expect(residualMemberChain("default", ["Header"])).toEqual(["Header"]);
    expect(residualMemberChain("Dialog", [])).toEqual([]);
  });

  it("a bare namespace usage (`<NS/>`, empty chain) has root `*` and no residual", () => {
    expect(effectiveExportName("*", [])).toBe("*");
    expect(residualMemberChain("*", [])).toEqual([]);
  });

  it("compoundExportName joins root and residual with dots, and is the identity function on an empty residual", () => {
    expect(compoundExportName("Dialog", ["Popup"])).toBe("Dialog.Popup");
    expect(compoundExportName("Dialog", ["Panel", "Title"])).toBe("Dialog.Panel.Title");
    expect(compoundExportName("Root", [])).toBe("Root");
    expect(compoundExportName("default", ["Header"])).toBe("default.Header");
  });

  it("effectiveExportName and residualMemberChain compose to the compound name for every import form", () => {
    const name = (imported: string, chain: string[]) =>
      compoundExportName(effectiveExportName(imported, chain), residualMemberChain(imported, chain));
    expect(name("Dialog", ["Popup"])).toBe("Dialog.Popup");
    expect(name("Dialog", ["Panel", "Title"])).toBe("Dialog.Panel.Title");
    expect(name("default", ["Header"])).toBe("default.Header");
    expect(name("*", ["Root"])).toBe("Root");
    expect(name("*", ["Root", "Foo"])).toBe("Root.Foo");
    expect(name("Button", [])).toBe("Button");
  });
});
