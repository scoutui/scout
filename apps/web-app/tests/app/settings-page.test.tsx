// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";

vi.mock("@/lib/identity", () => ({
  identify: async () => ({ kind: "person", userId: "u1", email: "ana@example.com", name: null, role: "admin", roleSource: "people" }),
}));
vi.mock("@/db/client", () => ({ getPool: () => ({}) }));
vi.mock("@/components/settings/people-table", () => ({ PeopleTable: () => null }));
vi.mock("@/lib/people", () => ({
  listPeople: async () => [],
  listRoleChanges: async () => [
    { id: "r1", changedAt: "2026-10-02T00:00:00.000Z", actorEmail: "ana@example.com", subjectEmail: "bo@example.com", fromRole: "viewer", toRole: "editor" },
  ],
}));
vi.mock("@/lib/scan-removal", () => ({
  listRemovals: async () => [
    { id: "d1", removedAt: "2026-10-03T00:00:00.000Z", actorEmail: "ana@example.com", repoId: "web-app", commitSha: null, scanCount: 4 },
    { id: "d0", removedAt: "2026-10-01T00:00:00.000Z", actorEmail: "ana@example.com", repoId: "web-app", commitSha: "1a2b3c4d5e6f", scanCount: null },
  ],
}));

describe("SettingsPage", () => {
  it("lists role changes, removed scans and deleted repos in one history, newest first", async () => {
    render(await SettingsPage());

    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getAllByRole("listitem").map(item => item.textContent?.split(" · ")[0])).toEqual([
      "ana@example.com deleted web-app",
      "ana@example.com made bo@example.com an Editor",
      "ana@example.com removed a scan of web-app (1a2b3c4)",
    ]);
  });

  it("says roles come from the sign-in provider's groups only when roles from groups only is on", async () => {
    const groupsOnlyNote = "Roles come from groups in your sign-in provider. To change someone's role, change their groups there.";
    const removalNote = "Removing someone signs them out everywhere. If your sign-in provider still lets them in, they come back as a Viewer, or with the role their group gives them.";
    vi.stubEnv("SCOUTUI_ROLES_FROM_GROUPS_ONLY", "true");
    const { unmount } = render(await SettingsPage());
    expect(screen.getByText(groupsOnlyNote)).toBeInTheDocument();
    expect(screen.getByText(removalNote)).toBeInTheDocument();
    unmount();

    vi.stubEnv("SCOUTUI_ROLES_FROM_GROUPS_ONLY", undefined);
    render(await SettingsPage());
    expect(screen.queryByText(groupsOnlyNote)).toBeNull();
    expect(screen.getByText(removalNote)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
