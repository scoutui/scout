// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardScopeBadge } from "@/components/dashboards/dashboard-scope-badge";

describe("DashboardScopeBadge", () => {
  it("renders the repoId for a live repo scope", () => {
    render(<DashboardScopeBadge scope={{ kind: "repo", repoId: "acme-web" }} />);
    expect(screen.getByText("acme-web")).toBeInTheDocument();
    expect(screen.queryByText(/missing/)).toBeNull();
  });

  it("marks a repo scope that no longer exists as missing", () => {
    render(<DashboardScopeBadge scope={{ kind: "repo", repoId: "old-name" }} missing="repo" />);
    expect(screen.getByText(/old-name · missing/)).toHaveAttribute(
      "title",
      "There are no scans for this repo any more. It may have been renamed or deleted.",
    );
  });

  it("says a repo scope has no scans yet when the repo exists without scans", () => {
    render(<DashboardScopeBadge scope={{ kind: "repo", repoId: "acme-web" }} missing="scans" />);
    expect(screen.getByText(/acme-web · no scans yet/)).toHaveAttribute(
      "title",
      "This repo has no scans yet. Its charts fill in after its first scan is uploaded.",
    );
    expect(screen.queryByText(/missing/)).toBeNull();
  });

  it("renders the all-repos chip", () => {
    render(<DashboardScopeBadge scope={{ kind: "all" }} />);
    expect(screen.getByText("All repos")).toBeInTheDocument();
  });
});
