import { describe, expect, it } from "vitest";
import { serialiseComponentId } from "../src/types/component-id.js";

describe("serialiseComponentId: two-axis key", () => {
  it("custom-element / external", () => {
    expect(
      serialiseComponentId({
        kind: "custom-element",
        tagName: "web-button",
        source: { type: "external", package: "@example/web-button" },
      }),
    ).toBe("custom-element:external:@example/web-button::web-button");
  });

  it("custom-element / local", () => {
    expect(
      serialiseComponentId({
        kind: "custom-element",
        tagName: "my-card",
        source: { type: "local", filePath: "src/elements/my-card.ts" },
      }),
    ).toBe("custom-element:local:src/elements/my-card.ts::my-card");
  });

  it("custom-element / unknown", () => {
    expect(
      serialiseComponentId({
        kind: "custom-element",
        tagName: "foo-bar-element",
        source: { type: "unknown" },
      }),
    ).toBe("custom-element:unknown::foo-bar-element");
  });

  it("react-component / external", () => {
    expect(
      serialiseComponentId({
        kind: "react-component",
        export: "Button",
        source: { type: "external", package: "@mui/material" },
      }),
    ).toBe("react-component:external:@mui/material::Button");
  });

  it("react-component / local", () => {
    expect(
      serialiseComponentId({
        kind: "react-component",
        export: "Button",
        source: { type: "local", filePath: "src/components/Button.tsx" },
      }),
    ).toBe("react-component:local:src/components/Button.tsx::Button");
  });

  it("vue-component / external", () => {
    expect(
      serialiseComponentId({
        kind: "vue-component",
        export: "VBtn",
        source: { type: "external", package: "vuetify" },
      }),
    ).toBe("vue-component:external:vuetify::VBtn");
  });

  it("vue-component / local", () => {
    expect(
      serialiseComponentId({
        kind: "vue-component",
        export: "Card",
        source: { type: "local", filePath: "src/ui/Card.vue" },
      }),
    ).toBe("vue-component:local:src/ui/Card.vue::Card");
  });
});
