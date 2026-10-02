// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RepoTabs } from "@/components/repos/repo-tabs";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", async () => ({
  ...(await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => window.location.pathname,
}));

const tabs = () => <RepoTabs components={<p>Component rows</p>} adoption={<p>Adoption charts</p>} />;

beforeEach(() => {
  replace.mockClear();
  window.history.replaceState(null, "", "/repos/r?scan=s1");
});

describe("RepoTabs", () => {
  it("opens the tab ?tab= names", () => {
    window.history.replaceState(null, "", "/repos/r?tab=adoption");
    render(tabs());
    expect(screen.getByRole("tab", { name: "Adoption" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Adoption charts")).toBeInTheDocument();
  });

  it("writes a tab switch into ?tab= without asking the server for the page, so Back reopens that tab", () => {
    const { unmount } = render(tabs());
    fireEvent.click(screen.getByRole("tab", { name: "Adoption" }));
    expect(screen.getByText("Adoption charts")).toBeInTheDocument();
    expect(window.location.search).toBe("?scan=s1&tab=adoption");
    expect(replace).not.toHaveBeenCalled();
    // Back restores this URL and mounts the page again.
    unmount();
    render(tabs());
    expect(screen.getByRole("tab", { name: "Adoption" })).toHaveAttribute("aria-selected", "true");
  });
});
