import { describe, it, expect, beforeAll } from "vitest";
import { isKind, type ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

// react-literal-tag exercises multiple concurrent identification paths in one
// React fixture:
//   1. Direct React-component import: `Button` from `@example/react-ds` in
//      `app/page.tsx`.
//   2. React import from web-button: `WebButton` from
//      `@example/web-button/dist/react.js`, a package export of its own.
//   3. Reference and written props: `WebButton` in `app/dynamic-page/page.tsx`
//      passes `variant` from a local (a reference) and `disabled={true}` (written).
//   4. A literal `<web-button>` custom element in `app/page.tsx`.

describe("integration: react-literal-tag fixture", () => {
  let scan: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: scan } = await scanFixture("react-literal-tag", { args: ["--quiet"] }));
  }, 30_000);

  it("emits WebButton and Button as package exports, and the literal web-button custom element as a tag", () => {
    // (1) WebButton wrapper: a package export.
    const webButton = scan.components.find(
      (c) =>
        c.identity.kind === "package-export" &&
        c.identity.exportName === "WebButton" &&
        c.identity.packageName === "@example/web-button",
    );
    expect(webButton, "WebButton package-export identity must surface").toBeTruthy();

    // (2) The literal `<web-button>` in app/page.tsx is a custom element: one
    // tag row, backed by that one occurrence.
    const tag = scan.components.filter((c) => c.identity.kind === "tag");
    expect(tag.map((c) => c.identity)).toEqual([{ kind: "tag", tagName: "web-button" }]);
    expect(
      scan.occurrences
        .filter((o) => o.resolution.status === "resolved" && o.resolution.componentId === tag[0]?.id)
        .map((o) => o.filePath),
    ).toEqual(["app/page.tsx"]);

    // (3) Button (react-only DS) is a package export.
    const button = scan.components.find(
      (c) =>
        c.identity.kind === "package-export" &&
        c.identity.exportName === "Button" &&
        c.identity.packageName === "@example/react-ds",
    );
    expect(button, "Button package-export identity must surface").toBeTruthy();

    // (4) Button direct-import occurrence preserved.
    const buttonOcc = scan.occurrences.find(
      (o) =>
        o.resolution.componentId === button?.id &&
        o.credit.kind === "render" &&
        o.trace.some((t) => isKind(t, "import") && t.name === "Button") &&
        o.filePath.endsWith("app/page.tsx"),
    );
    expect(buttonOcc, "Button direct-import in app/page.tsx expected").toBeTruthy();
  });

  it("emits no fabricated rows", () => {
    // Every external and tag row is occurrence-backed; nothing was fabricated.
    expect(
      scan.components.filter(
        (c) => (c.identity.kind === "package-export" || c.identity.kind === "tag") && c.stats.occurrenceCount === 0,
      ),
    ).toHaveLength(0);
  });

  it("identifier prop surfaces as a reference tier in occurrence", () => {
    // app/dynamic-page/page.tsx: `<WebButton variant={variant} disabled={true} />`
    // where `variant` is a plain const identifier → { tier: "reference", ref: "variant" }.
    const dynamicOcc = scan.occurrences.find(
      (o) =>
        o.filePath.endsWith("app/dynamic-page/page.tsx") &&
        o.props &&
        typeof o.props.variant === "object" &&
        o.props.variant !== null &&
        "tier" in (o.props.variant as object),
    );
    expect(dynamicOcc, "identifier-reference occurrence must surface").toBeDefined();
    expect(dynamicOcc?.props.variant).toEqual({ tier: "reference", ref: "variant" });
  });

  it("literal prop is captured as a written tier", () => {
    // app/dynamic-page/page.tsx: disabled={true} → { tier: "written", value: true }.
    const dynamicOcc = scan.occurrences.find((o) =>
      o.filePath.endsWith("app/dynamic-page/page.tsx"),
    );
    expect(dynamicOcc, "dynamic-page occurrence must surface").toBeDefined();
    expect(dynamicOcc?.props.disabled).toEqual({ tier: "written", value: true });
  });
});
