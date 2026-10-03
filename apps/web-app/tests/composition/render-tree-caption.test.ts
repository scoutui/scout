import { describe, it, expect } from "vitest";
import {
  renderTreeCaption,
  type CaptionPart,
  type RenderTreeCaption,
} from "@/components/component-detail/composition/render-tree-caption";

/** The caption as the header reads it: both lines, joined by a space. */
const text = (c: RenderTreeCaption) => [c.up, c.down].map((parts) => parts.map((p) => p.text).join("")).join(" ");
const marked = (parts: CaptionPart[], kind: CaptionPart["kind"]) =>
  parts.filter((p) => p.kind === kind).map((p) => p.text);

const base = { focusName: "Button", directParents: 196, dependents: 402, directChildren: 0, rendered: 0 };

describe("renderTreeCaption", () => {
  it("sink: direct count then the total that depends on it, empty down clause", () => {
    expect(text(renderTreeCaption(base))).toBe(
      "196 components render Button directly; 402 depend on it in total. Button renders no other components in this repo.",
    );
  });
  it("both sides read by the same rule: direct count, then the total behind it", () => {
    expect(
      text(renderTreeCaption({ focusName: "WebhookForm", directParents: 3, dependents: 9, directChildren: 11, rendered: 20 })),
    ).toBe(
      "3 components render WebhookForm directly; 9 depend on it in total. WebhookForm renders 11 components directly; 20 in total.",
    );
  });
  it("drops each total when nothing sits beyond the direct neighbours", () => {
    expect(
      text(renderTreeCaption({ focusName: "IconGrid", directParents: 4, dependents: 4, directChildren: 2, rendered: 2 })),
    ).toBe("4 components render IconGrid directly. IconGrid renders 2 components directly.");
  });
  it("singulars agree on both sides", () => {
    expect(
      text(renderTreeCaption({ focusName: "IconGrid", directParents: 1, dependents: 1, directChildren: 1, rendered: 1 })),
    ).toBe("1 component renders IconGrid directly. IconGrid renders 1 component directly.");
  });
  it("a single direct neighbour on each side still names the wider total", () => {
    expect(
      text(renderTreeCaption({ focusName: "IconGrid", directParents: 1, dependents: 6, directChildren: 1, rendered: 4 })),
    ).toBe(
      "1 component renders IconGrid directly; 6 depend on it in total. IconGrid renders 1 component directly; 4 in total.",
    );
  });
  it("nothing renders it: one plain sentence, no entry-point vocabulary", () => {
    expect(
      text(renderTreeCaption({ focusName: "Page", directParents: 0, dependents: 0, directChildren: 2, rendered: 5 })),
    ).toBe("Nothing in this repo renders Page. Page renders 2 components directly; 5 in total.");
  });
  it("renders nothing: the down clause says so instead of counting", () => {
    expect(
      text(renderTreeCaption({ focusName: "A", directParents: 1, dependents: 1, directChildren: 0, rendered: 0 })),
    ).toBe("1 component renders A directly. A renders no other components in this repo.");
  });
  it("formats thousands with separators on both totals", () => {
    expect(
      text(renderTreeCaption({ ...base, directParents: 1234, dependents: 5678, directChildren: 2, rendered: 4321 })),
    ).toBe(
      "1,234 components render Button directly; 5,678 depend on it in total. Button renders 2 components directly; 4,321 in total.",
    );
  });
  it("marks the counts and the name on each line, so the header can set them apart", () => {
    const caption = renderTreeCaption({ focusName: "WebhookForm", directParents: 3, dependents: 9, directChildren: 11, rendered: 20 });
    expect(marked(caption.up, "count")).toEqual(["3", "9"]);
    expect(marked(caption.up, "name")).toEqual(["WebhookForm"]);
    expect(marked(caption.down, "count")).toEqual(["11", "20"]);
    expect(marked(caption.down, "name")).toEqual(["WebhookForm"]);
  });
});
