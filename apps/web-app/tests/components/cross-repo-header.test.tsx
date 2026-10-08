// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CrossRepoComponentDetail } from "@scoutui/web-shared";
import { CrossRepoHeader } from "@/components/components-tab/cross-repo-header";

const detail: CrossRepoComponentDetail = {
  componentId: "c", packageName: "@example/ui", displayName: "Button", kind: "react-component", scope: "external",
  repoCount: 1, totalOccurrences: 1, distinctVersionCount: 1, deprecatedAnywhere: false,
  migrationStatus: { status: "active" }, governedByRecordId: null,
  usages: [{ repoId: "shop", version: "1.0.0", occurrenceCount: 1, deprecated: false, committedAt: "2026-05-15T10:00:00Z" }],
};

describe("CrossRepoHeader", () => {
  it("counts a single use as `1 use`", () => {
    render(<CrossRepoHeader detail={detail} canEdit={false} />);
    expect(screen.getByText("1 use")).toBeInTheDocument();
  });
});
