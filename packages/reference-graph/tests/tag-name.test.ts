import { describe, expect, it } from "vitest";
import { RESERVED_CUSTOM_ELEMENT_NAMES, canonicalTagName, isValidCustomElementName } from "../src/tag-name.js";

describe("custom element name grammar", () => {
  it.each(["x-card", "my-élan-2", "a-", "math-α", "emotion-😍"])("admits %s", (name) => {
    expect(isValidCustomElementName(name)).toBe(true);
  });

  it("admits a written tag once it is canonical", () => {
    expect(isValidCustomElementName("X-Card")).toBe(false);
    expect(canonicalTagName("X-Card")).toBe("x-card");
    expect(isValidCustomElementName(canonicalTagName("X-Card"))).toBe(true);
  });

  it.each(["font-face", "annotation-xml", "div", "-a", "1-a", "", "x-a b", "x-a/b", "x-a>b", "x-a\u0000b"])("rejects %j", (name) => {
    expect(isValidCustomElementName(name)).toBe(false);
  });

  // The HTML spec's reserved hyphenated names (valid custom element name, step 3).
  const SPEC_RESERVED = [
    "annotation-xml",
    "color-profile",
    "font-face",
    "font-face-src",
    "font-face-uri",
    "font-face-format",
    "font-face-name",
    "missing-glyph",
  ];

  it.each(SPEC_RESERVED)("rejects the reserved name %s", (name) => {
    expect(isValidCustomElementName(name)).toBe(false);
  });

  it("reserves exactly the spec's names", () => {
    expect(RESERVED_CUSTOM_ELEMENT_NAMES).toEqual(new Set(SPEC_RESERVED));
  });

  it("lowercases ASCII only", () => {
    expect(canonicalTagName("X-ÉLAN")).toBe("x-Élan");
  });
});
