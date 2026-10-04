import { describe, it, expect } from "vitest";
import { renderTreeCaption } from "@/components/component-detail/composition/render-tree-caption";

const none = { direct: 0, total: 0 };

describe("renderTreeCaption", () => {
  it.each([
    ["rendered by more in total than directly", { direct: 200, total: 400 }, none, "Rendered directly by 200 components, and by 400 in total."],
    ["rendered only directly", { direct: 3, total: 3 }, none, "Rendered directly by 3 components."],
    ["rendered by one component", { direct: 1, total: 1 }, none, "Rendered directly by 1 component."],
    ["renders more in total than directly", none, { direct: 11, total: 22 }, "Renders 11 components directly, and 22 in total."],
    ["renders only directly", none, { direct: 1, total: 1 }, "Renders 1 component directly."],
    [
      "both sides, up first",
      { direct: 3, total: 8 },
      { direct: 11, total: 22 },
      "Rendered directly by 3 components, and by 8 in total. Renders 11 components directly, and 22 in total.",
    ],
    ["thousands", { direct: 1200, total: 4500 }, none, "Rendered directly by 1,200 components, and by 4,500 in total."],
    ["nothing on either side", none, none, "Nothing in this repo renders Button, and Button renders no other components."],
  ])("%s", (_, up, down, expected) => {
    expect(renderTreeCaption("Button", up, down)).toBe(expected);
  });
});
