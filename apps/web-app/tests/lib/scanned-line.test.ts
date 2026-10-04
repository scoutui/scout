import { describe, expect, it } from "vitest";
import type { ScanScope } from "@scoutui/scan-format";
import { scannedLine } from "@/lib/scanned-line";

const scope = (over: Partial<ScanScope>): ScanScope => ({ folder: "", exclude: [], packages: [], ...over });

describe("scannedLine", () => {
  it.each<[string, ScanScope | null, string | null]>([
    ["a scan that doesn't record its scope", null, null],
    ["the whole repository", scope({}), null],
    ["left-out folders", scope({ exclude: ["apps/playground", "packages/shared-ui"] }), "Scanned: everything except apps/playground, packages/shared-ui."],
    ["only glob entries", scope({ exclude: ["**/*.test.*", "**/node_modules/**"] }), null],
    ["a folder spelled with ./ and a trailing slash", scope({ exclude: ["./apps/old/"] }), "Scanned: everything except apps/old."],
    ["a folder spelled as folder/**", scope({ exclude: ["apps/old/**"] }), "Scanned: everything except apps/old."],
    ["a config in a subfolder", scope({ folder: "apps/web" }), "Scanned: apps/web only."],
    ["a config in a subfolder that leaves out a folder", scope({ folder: "apps/web", exclude: ["legacy"] }), "Scanned: apps/web, except apps/web/legacy."],
    ["an include", scope({ include: ["src/**/*.{ts,tsx}"] }), "Scanned: src/**/*.{ts,tsx} only."],
    ["an include in a subfolder", scope({ folder: "apps/web", include: ["src/**"] }), "Scanned: apps/web/src/** only."],
    ["two includes and a left-out folder", scope({ include: ["src/**", "lib/**"], exclude: ["src/legacy/**"] }), "Scanned: src/**, lib/**, except src/legacy."],
  ])("%s", (_, given, line) => {
    expect(scannedLine(given)).toBe(line);
  });
});
