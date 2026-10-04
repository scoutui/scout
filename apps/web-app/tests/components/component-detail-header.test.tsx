// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentDetail } from "@scoutui/web-shared";
import { ComponentDetailHeader } from "@/components/component-detail/component-detail-header";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/x" }));

function makeDetail(overrides?: Partial<ComponentDetail>): ComponentDetail {
  return {
    componentId: "c", repoId: "r", displayName: "Button", packageName: "@example/ui", publicEntry: "dist/button",
    scope: "external", kind: "react-component", version: null, deprecated: false, hasDeclaredApi: false, hasRest: false,
    migrationStatus: { status: "active" }, governedByRecordId: null, definedAt: null, props: [], events: [],
    composition: { renders: [], renderedBy: [], isRootCount: 0, isLeafCount: 0 }, occurrences: [],
    summary: { footprint: { callCount: 0, fileCount: 0, rendersCount: 0, renderedByCount: 0 }, apiUsage: { declaredCount: 0, usedCount: 0, neverUsedCount: 0, undeclaredCount: 0 }, provenance: { written: 0, reference: 0, dynamic: 0 } },
    ...overrides,
  };
}

/** The line under the name: package, public entry, version and definition site. */
function identityLine(): string {
  return screen.getByText("@example/ui").parentElement?.textContent ?? "";
}

describe("ComponentDetailHeader", () => {
  it("shows a package export's package and public entry", () => {
    render(<ComponentDetailHeader detail={makeDetail()} />);
    expect(identityLine()).toBe("@example/ui·dist/button");
  });

  it("shows no entry for a package export at the package root", () => {
    render(<ComponentDetailHeader detail={makeDetail({ publicEntry: "" })} />);
    expect(identityLine()).toBe("@example/ui");
  });

  it("renders no 'Used as', 'via' or manifest badge, whatever else the detail carries", () => {
    const detail = {
      ...makeDetail(),
      manifest: { source: "cem" },
      entryPackages: [{ package: "@example/wrapper", version: "1.0.0" }],
      realizations: [{ componentId: "w", displayName: "XButton", kind: "react-component", packageName: "@example/react", version: null, occurrenceCount: 1, fileCount: 1, fileTypes: [] }],
    } as unknown as ComponentDetail;
    render(<ComponentDetailHeader detail={detail} />);
    // The header still renders its real content from the same detail.
    expect(screen.getByRole("heading", { level: 1, name: "Button" })).toBeInTheDocument();
    expect(identityLine()).toBe("@example/ui·dist/button");
    expect(screen.queryByText(/Used as/)).toBeNull();
    expect(screen.queryByText(/\bvia\b/)).toBeNull();
    expect(screen.queryByText(/manifest/)).toBeNull();
  });

  it("shows where a repository declaration is defined", () => {
    render(
      <ComponentDetailHeader
        detail={makeDetail({
          scope: "local",
          publicEntry: null,
          definedAt: { filePath: "src/components/Button.tsx", line: 4, column: 16 },
        })}
      />,
    );
    expect(identityLine()).toBe("@example/ui·defined at src/components/Button.tsx:4:16");
  });

  it("names the origin in its badge, with what it means as the badge's title", () => {
    render(<ComponentDetailHeader detail={makeDetail({ scope: "local" })} />);
    expect(screen.getByText("Local")).toHaveAttribute("title", "Defined in this repo");
  });

  it("puts the warning triangle in the deprecated pill", () => {
    render(<ComponentDetailHeader detail={makeDetail({ deprecated: true })} />);
    const pill = screen.getByText("Deprecated").closest("[data-slot=badge]");
    expect(pill?.querySelector("svg")).toBeInstanceOf(SVGElement);
  });
});
