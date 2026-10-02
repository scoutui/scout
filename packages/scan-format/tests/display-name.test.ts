import { describe, expect, it } from "vitest";
import { displayNameOf } from "../src/display-name.js";
import type { Identity } from "../src/schema.js";

const packageExport = (packageName: string, exportName: string, publicEntry = ""): Identity =>
  ({ kind: "package-export", packageName, publicEntry, exportName });
const repoDeclaration = (repoId: string, filePath: string, exportName: string): Identity =>
  ({ kind: "repository-declaration", repoId, filePath, exportName });

describe("displayNameOf: default-export labelling", () => {
  it("package default export → last public entry segment", () => {
    expect(displayNameOf({ identity: packageExport("next", "default", "link") })).toBe("link");
    expect(displayNameOf({ identity: packageExport("next", "default", "head") })).toBe("head");
    expect(displayNameOf({ identity: packageExport("@scope/pkg", "default", "dist/components/button") })).toBe("button");
  });

  it("package default export at the root entry → packageName", () => {
    expect(displayNameOf({ identity: packageExport("somepkg", "default") })).toBe("somepkg");
  });

  it("named package export is unchanged", () => {
    expect(displayNameOf({ identity: packageExport("next", "ExampleButton", "link") })).toBe("ExampleButton");
  });

  it("tags and repository declarations are unchanged", () => {
    expect(displayNameOf({ identity: { kind: "tag", tagName: "x-button" } })).toBe("x-button");
    expect(displayNameOf({ identity: repoDeclaration("repo-a", "src/layout.tsx", "NavigationLayout") })).toBe("NavigationLayout");
  });

  it("package default-import member → `<segment>.<member chain>`", () => {
    expect(displayNameOf({ identity: packageExport("pkg", "default.Header", "Modal") })).toBe("Modal.Header");
    expect(displayNameOf({ identity: packageExport("react", "default.Fragment") })).toBe("react.Fragment");
    expect(displayNameOf({ identity: packageExport("pkg", "default.Field.Label", "ui/Form") })).toBe("Form.Field.Label");
  });

  it("a named compound export renders verbatim, package or local", () => {
    expect(displayNameOf({ identity: packageExport("pkg", "Dialog.Popup") })).toBe("Dialog.Popup");
    expect(displayNameOf({ identity: repoDeclaration("repo-a", "src/ns.tsx", "NS.Inline") })).toBe("NS.Inline");
  });
});
