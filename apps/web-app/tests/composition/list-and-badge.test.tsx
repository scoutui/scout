// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentDetail } from "@scoutui/web-shared";
import { DetailTabs } from "@/components/component-detail/detail-tabs";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", async () => ({
  ...(await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => window.location.pathname,
}));
vi.mock("@/components/component-detail/composition/composition-canvas", () => ({
  CompositionCanvas: () => <div data-testid="canvas-stub" />,
}));

const detail = {
  componentId: "F", repoId: "r/x", scope: "local", displayName: "F",
  composition: {
    renders: [{ componentId: "kid", displayName: "Kid", packageName: null, scope: "local", count: 3 }],
    renderedBy: [{ componentId: "owner", displayName: "Owner", packageName: "@x/a", scope: "external", count: 2 }],
    isRootCount: 0, isLeafCount: 0,
  },
  occurrences: [], events: [], manifest: null, props: [],
} as unknown as ComponentDetail;

const tabs = () => <DetailTabs detail={detail} graph={{ nodes: [], edges: [] }} source={null} />;

beforeEach(() => {
  replace.mockClear();
  window.history.replaceState(null, "", "/x?scan=s1");
});

describe("detail tabs", () => {
  it("Composition carries no render/rendered-by count pair: the panel headers inside the tab already say this", () => {
    window.history.replaceState(null, "", "/x?tab=composition");
    render(tabs());
    expect(screen.getByRole("tab", { name: "Composition" })).toBeInTheDocument();
    expect(screen.queryByText(/renders 1, rendered by 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1↓ \/ 1↑/)).not.toBeInTheDocument();
  });

  it("is a tablist with roving tabindex and arrow-key activation", () => {
    render(tabs());
    const tablist = screen.getByRole("tablist", { name: "Component detail sections" });
    const usage = screen.getByRole("tab", { name: /Usage/ });
    const composition = screen.getByRole("tab", { name: /Composition/ });
    expect(usage).toHaveAttribute("aria-selected", "true");
    expect(usage).toHaveAttribute("tabindex", "0");
    expect(composition).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Composition/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-composition");
  });

  it("writes a tab switch into ?tab= without asking the server for the page, so Back reopens that tab", () => {
    const { unmount } = render(tabs());
    fireEvent.click(screen.getByRole("tab", { name: /Composition/ }));
    expect(window.location.search).toBe("?scan=s1&tab=composition");
    expect(replace).not.toHaveBeenCalled();
    // Back restores this URL and mounts the page again.
    unmount();
    render(tabs());
    expect(screen.getByRole("tab", { name: /Composition/ })).toHaveAttribute("aria-selected", "true");
  });
});
