import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSync as oxcParseSync } from "oxc-parser";
import type { Program } from "@oxc-project/types";
import { detectWebComponents, registeredClassName } from "../../src/local-index/detect-wc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures", "local-detection");

const parseFor = (source: string, filename: string): Program =>
  (oxcParseSync(filename, source) as { program: Program }).program;

describe("detectWebComponents: fixture matrix", () => {
  it("wc-decorator/MyCard.ts detects @customElement decorator", () => {
    const dir = "wc-decorator";
    const file = "MyCard.ts";
    const filePath = `tests/fixtures/local-detection/${dir}/${file}`;
    const source = readFileSync(join(FIXTURES, dir, file), "utf8");
    const out = detectWebComponents(parseFor(source, file), source, filePath);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      exportName: "MyCard",
      detector: "wc-decorator",
      componentId: {
        kind: "custom-element",
        tagName: "my-card",
        source: { type: "local", filePath },
      },
      loc: { file: filePath, line: 2 },
    });
  });

  it("wc-customelements-define/MyButton.ts detects customElements.define call", () => {
    const dir = "wc-customelements-define";
    const file = "MyButton.ts";
    const filePath = `tests/fixtures/local-detection/${dir}/${file}`;
    const source = readFileSync(join(FIXTURES, dir, file), "utf8");
    const out = detectWebComponents(parseFor(source, file), source, filePath);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      exportName: "MyButton",
      detector: "wc-customelements-define",
      componentId: {
        kind: "custom-element",
        tagName: "my-button",
        source: { type: "local", filePath },
      },
      loc: { file: filePath, line: 2 },
    });
  });
});

describe("detectWebComponents: registered names", () => {
  const detect = (source: string) => detectWebComponents(parseFor(source, "x.ts"), source, "src/x.ts");

  it("keys a registration by its canonical name and skips names that are not valid custom element names", () => {
    const out = detect(
      [
        "class A extends HTMLElement {}",
        'customElements.define("X-Card", A);',
        'customElements.define("font-face", A);',
        'customElements.define("card", A);',
      ].join("\n"),
    );
    expect(out.map((d) => d.componentId.kind === "custom-element" && d.componentId.tagName)).toEqual(["x-card"]);
  });

  it("detects a define called on window, globalThis or self's customElements", () => {
    const out = detect(
      [
        "class A extends HTMLElement {}",
        'window.customElements.define("x-one", A);',
        'globalThis.customElements.define("x-two", A);',
        'self.customElements.define("x-three", A);',
        'other.customElements.define("x-four", A);',
      ].join("\n"),
    );
    expect(out.map((d) => [d.componentId.kind === "custom-element" && d.componentId.tagName, d.exportName, d.detector, d.loc])).toEqual([
      ["x-one", "A", "wc-customelements-define", { file: "src/x.ts", line: 2, column: 1 }],
      ["x-two", "A", "wc-customelements-define", { file: "src/x.ts", line: 3, column: 1 }],
      ["x-three", "A", "wc-customelements-define", { file: "src/x.ts", line: 4, column: 1 }],
    ]);
  });

  it("names no class when the registration passes none", () => {
    const [inline] = detect('customElements.define("x-inline", class extends HTMLElement {});');
    const [named] = detect('class B extends HTMLElement {}\ncustomElements.define("x-named", B);');
    expect(inline && registeredClassName(inline)).toBeNull();
    expect(named && registeredClassName(named)).toBe("B");
  });
});
