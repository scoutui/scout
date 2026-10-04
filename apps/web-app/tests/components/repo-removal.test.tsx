// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({ removeScan: vi.fn(), deleteRepo: vi.fn() }));
vi.mock("@/app/repos/repo-actions", () => actions);

import { RepoActionsMenu } from "@/components/repos/repo-actions-menu";
import { ScanRowActions } from "@/components/repos/scan-row-actions";

const viewScan = <a href="/repos/web-app">View scan</a>;

async function dialogTitle(): Promise<string | null | undefined> {
  const dialog = await screen.findByRole("dialog");
  return document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent;
}

async function choose(menuButton: string, item: string) {
  fireEvent.click(screen.getByRole("button", { name: menuButton }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

afterEach(() => {
  actions.removeScan.mockReset();
  actions.deleteRepo.mockReset();
});

describe("RepoActionsMenu", () => {
  it("enables Delete repo only once the repo's name is typed exactly, then deletes the repo", async () => {
    actions.deleteRepo.mockResolvedValue(undefined);
    render(<RepoActionsMenu repoId="web-app" scanCount={5} />);
    await choose("Repo actions", "Delete repo…");

    expect(await dialogTitle()).toBe("Delete web-app?");
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "This deletes the repo and its 5 scans. It comes back the next time a scan of it is uploaded.",
    );
    const confirm = screen.getByRole("textbox", { name: "Type web-app to confirm" });
    const deleteButton = screen.getByRole("button", { name: "Delete repo" });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirm, { target: { value: "web-ap" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirm, { target: { value: "Web-app" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirm, { target: { value: "web-app" } });
    expect(deleteButton).toBeEnabled();

    fireEvent.click(deleteButton);
    await waitFor(() => expect(actions.deleteRepo).toHaveBeenCalledExactlyOnceWith("web-app"));
  });

  it("says one scan in the singular and shows why a delete failed", async () => {
    actions.deleteRepo.mockResolvedValue({ ok: false, error: "Couldn't delete the repo. Try again." });
    render(<RepoActionsMenu repoId="web-app" scanCount={1} />);
    await choose("Repo actions", "Delete repo…");

    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(
      "This deletes the repo and its 1 scan. It comes back the next time a scan of it is uploaded.",
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "web-app" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete repo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the repo. Try again.");
  });
});

describe("ScanRowActions", () => {
  it("asks to confirm in the row, hiding View scan until the confirm is cancelled", async () => {
    render(<ScanRowActions repoId="web-app" scanId="scan-b" scanCount={5}>{viewScan}</ScanRowActions>);
    await choose("Scan actions", "Remove scan");

    expect(await screen.findByText("Remove this scan?")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan actions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("link", { name: "View scan" })).toBeInTheDocument();
    expect(screen.queryByText("Remove this scan?")).toBeNull();
    expect(actions.removeScan).not.toHaveBeenCalled();
  });

  it("removes the scan once confirmed, and shows why a removal failed", async () => {
    actions.removeScan.mockResolvedValue({ ok: false, error: "The scan history has changed since the page loaded. Reload to see it." });
    render(<ScanRowActions repoId="web-app" scanId="scan-b" scanCount={5}>{viewScan}</ScanRowActions>);
    await choose("Scan actions", "Remove scan");
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(actions.removeScan).toHaveBeenCalledExactlyOnceWith("web-app", "scan-b"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The scan history has changed since the page loaded. Reload to see it.");
  });

  it("offers Delete repo… instead on a repo's only scan", async () => {
    render(<ScanRowActions repoId="web-app" scanId="scan-a" scanCount={1}>{viewScan}</ScanRowActions>);
    await choose("Scan actions", "Delete repo…");

    expect(await dialogTitle()).toBe("Delete web-app?");
    expect(screen.queryByRole("menuitem", { name: "Remove scan" })).toBeNull();
  });
});
