import { describe, expect, it } from "vitest";
import { isFrameworkRootPath } from "../../../src/scan/framework-root.js";

describe("isFrameworkRootPath", () => {
  it("matches Next.js app-router reserved files", () => {
    for (const f of ["page", "layout", "template", "error", "loading", "not-found"]) {
      expect(isFrameworkRootPath(`src/app/dashboard/${f}.tsx`)).toBe(true);
    }
  });
  it("matches with a floating prefix (ancestor --repo-root shape)", () => {
    expect(isFrameworkRootPath("nextjs-app-v14/src/app/page.tsx")).toBe(true);
    expect(isFrameworkRootPath("apps/web/pages/settings/profile.jsx")).toBe(true);
  });
  it("matches pages-router files but not pages/api", () => {
    expect(isFrameworkRootPath("src/pages/about.tsx")).toBe(true);
    expect(isFrameworkRootPath("src/pages/api/auth.tsx")).toBe(false);
  });
  it("does not match ordinary components", () => {
    expect(isFrameworkRootPath("src/app/components/button/button.tsx")).toBe(false);
    expect(isFrameworkRootPath("src/app/components/lottie-player/lottie-player.tsx")).toBe(false);
  });
});
