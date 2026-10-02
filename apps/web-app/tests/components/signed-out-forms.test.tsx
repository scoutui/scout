// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GovernanceRecord, Tag } from "@scoutui/web-shared";
import { DashboardBuilder } from "@/components/dashboards/dashboard-builder";
import { DeleteDashboardButton } from "@/components/dashboards/delete-dashboard-button";
import { GovernanceManager } from "@/components/governance/governance-manager";
import { QuickTag } from "@/components/tags/quick-tag";
import { TagsPanel } from "@/components/tags/tags-panel";

// The real server actions run against a session that has ended.
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/storage", () => ({
  getStorage: () => { throw new Error("A signed-out action reached storage"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock("@/app/charts/dashboard-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/charts/dashboard-actions")>()),
  previewDashboard: async () => ({ state: "ready", value: { kind: "series", series: [] } }),
  pickableForRepo: async () => ({ state: "ready", value: { components: [], packages: [] } }),
}));

Element.prototype.scrollIntoView = vi.fn();

const tag: Tag = {
  id: "t1",
  value: "core",
  category: "library",
  color: "chart-1",
  rule: { glob: [], exact: ["@example/button"] },
};

const record: GovernanceRecord = {
  id: "r1",
  grain: "component",
  targetPackage: "@example/old",
  targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@example/new", exportName: "Button" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function governance() {
  render(
    <GovernanceManager
      records={[record]}
      sources={[
        { packageName: "@example/old", exportName: "Button" },
        { packageName: "@example/new", exportName: "Button" },
      ]}
      stats={{}}
      repoCount={0}
      summary={null}
      notice={null}
    />,
  );
}

describe("forms after the session has ended", () => {
  it("tells the chart builder to sign in again to save", async () => {
    render(<DashboardBuilder libraryTags={[]} repos={["repo-a"]} components={[]} packages={[]} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Adoption" } });
    fireEvent.click(screen.getByRole("button", { name: "Local components" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    expect(await screen.findByText("Your session has ended. Sign in again to save this chart.")).toBeInTheDocument();
  });

  it("tells chart delete to sign in again", async () => {
    render(<DeleteDashboardButton id="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete chart" }));
    expect(await screen.findByText("Your session has ended. Sign in again to delete this chart.")).toBeInTheDocument();
  });

  it("tells the governance form to sign in again to save", async () => {
    governance();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Your session has ended. Sign in again to save this record.")).toBeInTheDocument();
  });

  it("tells governance delete to sign in again", async () => {
    governance();
    fireEvent.click(screen.getByRole("button", { name: "Edit Button" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Your session has ended. Sign in again to delete this record.")).toBeInTheDocument();
  });

  it("tells the tag editor to sign in again to save or delete", async () => {
    render(<TagsPanel allTags={[tag]} packageNames={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit core" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Your session has ended. Sign in again to save this tag.")).toBeInTheDocument();
    // The error can show before the save's transition ends, while Delete is still disabled.
    const remove = screen.getByRole("button", { name: "Delete" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Your session has ended. Sign in again to delete this tag.")).toBeInTheDocument();
  });

  it("tells the quick tag menu to sign in again", async () => {
    render(<QuickTag packageName="@example/card" allTags={[tag]} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag @example/card" }));
    fireEvent.click(await screen.findByRole("button", { name: /core/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has ended. Sign in again to change tags.");
  });
});
