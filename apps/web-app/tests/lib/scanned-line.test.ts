import { describe, expect, it } from "vitest";
import type { ScanScope } from "@scoutui/scan-format";
import { scannedLine, type ScannedPart } from "@/lib/scanned-line";

const scope = (over: Partial<ScanScope>): ScanScope => ({ folder: "", exclude: [], packages: [], ...over });
const text = (parts: ScannedPart[] | null) => parts?.map((part) => ("path" in part ? part.path : part.text)).join("") ?? null;

describe("scannedLine", () => {
  it.each<[string, ScanScope | null, string | null]>([
    ["a scan that doesn't record its scope", null, null],
    ["the whole repository", scope({}), null],
    ["left-out folders", scope({ exclude: ["apps/playground", "packages/shared-ui"] }), "Scanned: everything except apps/playground/, packages/shared-ui/."],
    ["only glob entries", scope({ exclude: ["**/*.test.*", "**/node_modules/**"] }), "Scanned: everything except files matching 2 patterns."],
    ["one glob entry", scope({ exclude: ["**/*.stories.*"] }), "Scanned: everything except files matching 1 pattern."],
    ["left-out folders and glob entries", scope({ exclude: ["test", "**/*.stories.*", "examples", "**/node_modules/**"] }), "Scanned: everything except test/, examples/, and files matching 2 patterns."],
    ["a folder spelled with ./ and a trailing slash", scope({ exclude: ["./apps/old/"] }), "Scanned: everything except apps/old/."],
    ["a folder spelled as folder/**", scope({ exclude: ["apps/old/**"] }), "Scanned: everything except apps/old/."],
    ["a left-out file", scope({ exclude: ["src/setupTests.ts"] }), "Scanned: everything except src/setupTests.ts."],
    ["a left-out folder whose name starts with a dot", scope({ exclude: [".storybook"] }), "Scanned: everything except .storybook/."],
    ["a config in a subfolder", scope({ folder: "apps/web" }), "Scanned: apps/web/ only."],
    ["a config in a subfolder that leaves out a folder", scope({ folder: "apps/web", exclude: ["legacy"] }), "Scanned: apps/web/, except apps/web/legacy/."],
    ["a config in a subfolder that leaves out a glob", scope({ folder: "apps/web", exclude: ["**/*.test.*"] }), "Scanned: apps/web/, except files matching 1 pattern."],
    ["an include", scope({ include: ["src/**/*.{ts,tsx}"] }), "Scanned: src/**/*.{ts,tsx} only."],
    ["an include in a subfolder", scope({ folder: "apps/web", include: ["src/**"] }), "Scanned: apps/web/src/** only."],
    ["two includes and a left-out folder", scope({ include: ["src/**", "lib/**"], exclude: ["src/legacy/**"] }), "Scanned: src/**, lib/**, except src/legacy/."],
    ["an include and glob entries", scope({ include: ["src/**"], exclude: ["**/*.{test,spec,stories}.*", "**/node_modules/**"] }), "Scanned: src/**, except files matching 2 patterns."],
  ])("%s", (_, given, line) => {
    expect(text(scannedLine(given))).toBe(line);
  });

  it("marks the config folder as a path and lists the patterns from the repo root in the phrase's title", () => {
    expect(scannedLine(scope({ folder: "apps/web", exclude: ["**/*.test.*"] }))).toEqual([
      { text: "Scanned: " },
      { path: "apps/web/" },
      { text: ", except " },
      { text: "files matching 1 pattern", title: "apps/web/**/*.test.*" },
      { text: "." },
    ]);
  });

  it("marks each include and left-out folder as a path and puts one pattern per line in the title", () => {
    expect(scannedLine(scope({ include: ["src/**"], exclude: ["src/legacy", "**/*.{test,spec,stories}.*", "**/node_modules/**"] }))).toEqual([
      { text: "Scanned: " },
      { path: "src/**" },
      { text: ", except " },
      { path: "src/legacy/" },
      { text: ", and " },
      { text: "files matching 2 patterns", title: "**/*.{test,spec,stories}.*\n**/node_modules/**" },
      { text: "." },
    ]);
  });
});
