/**
 * Proves the React and Angular lanes coexist in one repo: a React component
 * rendering a React component, and an Angular component rendering an
 * Angular component, neither lane affecting the other's resolution.
 *
 * Blocked the same way as angular-app.test.ts (see the note at the top of
 * that file): scan.ts/parse-by-ext.ts don't route Angular files yet, so this
 * currently errors before any assertion runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact<Diagnostic>;
const prevEnv = process.env.SCOUT_TEST_ANGULAR_COMPILER;

beforeAll(async () => {
  // Any one supported major proves coexistence; the version matrix itself is angular-app.test.ts's job.
  process.env.SCOUT_TEST_ANGULAR_COMPILER = require.resolve("@angular/compiler-21");
  ({ artifact: out } = await scanFixture("mixed-react-angular"));
}, 120_000);

afterAll(() => {
  // biome-ignore lint/performance/noDelete: process.env coerces an `undefined` assignment to the string "undefined"; delete is the only way to truly unset it.
  if (prevEnv === undefined) delete process.env.SCOUT_TEST_ANGULAR_COMPILER;
  else process.env.SCOUT_TEST_ANGULAR_COMPILER = prevEnv;
});

describe("integration: mixed-react-angular fixture", () => {
  it("resolves the React render, framework: \"react\"", () => {
    const widget = out.components.find(
      (c) => c.identity.kind === "repository-declaration" && c.identity.filePath === "src/react/Widget.tsx",
    );
    expect(widget).toBeDefined();
    expect(widget?.framework).toBe("react");
    expect(widget?.stats.occurrenceCount).toBeGreaterThan(0);
  });

  it("resolves the Angular render, framework: \"angular\"", () => {
    const widget = out.components.find(
      (c) => c.identity.kind === "repository-declaration" && c.identity.filePath === "src/angular/widget.component.ts",
    );
    expect(widget).toBeDefined();
    expect(widget?.framework).toBe("angular");
    expect(widget?.stats.occurrenceCount).toBeGreaterThan(0);
  });

  it("the React and Angular components are distinct entries, each owned within its own lane", () => {
    const reactOcc = out.occurrences.find((o) => o.filePath === "src/react/App.tsx");
    const angularOcc = out.occurrences.find((o) => o.filePath.startsWith("src/angular/"));
    expect(reactOcc?.resolution.status).toBe("resolved");
    expect(angularOcc?.resolution.status).toBe("resolved");
  });
});
