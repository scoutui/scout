// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({ setDashboardVisibility: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/charts/dashboard-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChartMenu } from "@/components/dashboards/chart-menu";

const open = () => fireEvent.click(screen.getByRole("button", { name: "More actions" }));

describe("ChartMenu", () => {
  it.each([
    { visibility: "private" as const, item: "Share with everyone", absent: "Make private", next: "everyone" },
    { visibility: "everyone" as const, item: "Make private", absent: "Share with everyone", next: "private" },
  ])("offers $item on a $visibility chart and saves it as $next", async ({ visibility, item, absent, next }) => {
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility={visibility} />);
    open();
    const offered = await screen.findByRole("menuitem", { name: item });
    expect(screen.queryByRole("menuitem", { name: absent })).toBeNull();
    fireEvent.click(offered);
    await waitFor(() => expect(actions.setDashboardVisibility).toHaveBeenCalledWith("chart 1", next));
  });

  it("offers no sharing to someone who can't change the chart", async () => {
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility={null} />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Share with everyone" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Make private" })).toBeNull();
  });

  it("copies the chart's link and says so", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility={null} />);
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/charts/chart%201`);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("offers Duplicate only to someone who can make charts", async () => {
    const { unmount } = render(<ChartMenu id="chart 1" canDuplicate visibility={null} />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toHaveAttribute("href", "/charts/new?from=chart%201");
    unmount();
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility={null} />);
    open();
    await screen.findByRole("menuitem", { name: "Copy link" });
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).toBeNull();
  });
});
