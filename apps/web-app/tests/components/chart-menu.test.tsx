// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChartRange, ChartVisibility, CohortPoint, CohortSelector, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";

const actions = vi.hoisted(() => ({ setDashboardVisibility: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/charts/dashboard-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const image = vi.hoisted(() => ({ chartPng: vi.fn(async (_input: unknown) => new Blob(["png"], { type: "image/png" })) }));
vi.mock("@/lib/chart-png", () => image);

import { ChartExportProvider } from "@/components/dashboards/chart-export-context";
import { ChartMenu } from "@/components/dashboards/chart-menu";
import { LinkedDashboardChart } from "@/components/dashboards/dashboard-chart";

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
    render(<ChartMenu id="chart 1" canDuplicate visibility={null} />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Share with everyone" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Make private" })).toBeNull();
  });

  it("offers Duplicate only to someone who can make charts", async () => {
    const { unmount } = render(<ChartMenu id="chart 1" canDuplicate visibility={null} />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toHaveAttribute("href", "/charts/new?from=chart%201");
    unmount();
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility="private" />);
    open();
    await screen.findByRole("menuitem", { name: "Share with everyone" });
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).toBeNull();
  });
});

const LATEST = "2026-09-30T12:00:00Z";
const web = { cohortKey: "package:@example/web", label: "@example/web", color: "" };
const button = { cohortKey: "component:btn", label: "Button · @example/ui", color: "" };
const cohorts: CohortSelector[] = [
  { kind: "package", packageName: "@example/web" },
  { kind: "component", componentId: "btn" },
];
const series: CohortSeries[] = [
  {
    ...web,
    points: [
      { t: "2025-10-01T00:00:00Z", value: 10 },
      { t: "2026-01-01T00:00:00Z", value: 20 },
      { t: "2026-04-01T00:00:00Z", value: 30 },
      { t: "2026-07-01T00:00:00Z", value: 40 },
      { t: LATEST, value: 50 },
    ],
  },
  { ...button, points: [{ t: "2026-08-01T00:00:00Z", value: 5 }, { t: LATEST, value: 8 }] },
];
const coverage = { total: 2, points: [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort().map((t) => ({ t, repos: 2 })) };
const points: CohortPoint[] = [
  { ...web, value: 50, componentCount: 3 },
  { ...button, value: 8, componentCount: 1 },
];
const views: Record<DashboardConfig["chartType"], DashboardView> = {
  trend: { kind: "series", series, coverage },
  "stacked-share": { kind: "series", series, coverage },
  bars: { kind: "snapshot", points },
  table: { kind: "table", points, series, coverage },
};

const TITLE = "Button: adoption";

type Menu = { canDuplicate: boolean; visibility: ChartVisibility | null };

function renderChart(chartType: DashboardConfig["chartType"], range: ChartRange = "3m", menu: Menu = { canDuplicate: false, visibility: null }) {
  const config: DashboardConfig = { scope: { kind: "all" }, cohorts, chartType, metric: "count" };
  render(
    <ChartExportProvider title={TITLE}>
      <ChartMenu id="chart 1" {...menu} />
      <LinkedDashboardChart config={config} view={views[chartType]} range={range} />
    </ChartExportProvider>,
  );
  return config;
}

async function menuItems(): Promise<string[]> {
  open();
  return (await screen.findAllByRole("menuitem")).map((item) => item.textContent ?? "");
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

describe("ChartMenu export", () => {
  const clipboard = { write: vi.fn(async (_items: unknown[]) => {}), writeText: vi.fn(async (_text: string) => {}) };
  const saved: Array<{ download: string; href: string }> = [];

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 320));
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() });
    saved.length = 0;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ download: this.download, href: this.href });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clipboard.write.mockReset();
    clipboard.writeText.mockReset();
    image.chartPng.mockClear();
  });

  it.each([
    ["trend", ["Download image", "Copy image", "Download data", "Copy data"]],
    ["stacked-share", ["Download image", "Copy image", "Download data", "Copy data"]],
    ["bars", ["Download image", "Copy image", "Download data", "Copy data"]],
    ["table", ["Download data", "Copy data"]],
  ] as const)("offers a %s chart's export items", async (chartType, items) => {
    renderChart(chartType);
    expect(await menuItems()).toEqual(items);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("offers no Copy image where the browser can't copy images", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    renderChart("trend");
    expect(await menuItems()).toEqual(["Download image", "Download data", "Copy data"]);
  });

  it("sets sharing and Duplicate apart after the export items", async () => {
    renderChart("trend", "3m", { canDuplicate: true, visibility: "private" });
    expect(await menuItems()).toEqual(["Download image", "Copy image", "Download data", "Copy data", "Share with everyone", "Duplicate"]);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("renders nothing when it has no items", () => {
    const { container } = render(
      <ChartExportProvider title={TITLE}>
        <ChartMenu id="chart 1" canDuplicate={false} visibility={null} />
      </ChartExportProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("copies the data of the range on screen as tab-separated text, and of a range picked after", async () => {
    clipboard.writeText.mockResolvedValue(undefined);
    renderChart("trend", "3m");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy data" }));
    expect(clipboard.writeText).toHaveBeenCalledOnce();
    expect(clipboard.writeText.mock.lastCall?.[0].split("\n").slice(0, 2)).toEqual([
      "Committed (UTC)\t@example/web\tButton · @example/ui",
      "2026-07-01 00:00\t40\t",
    ]);
    expect(await screen.findByText("Data copied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy data" }));
    expect(clipboard.writeText.mock.lastCall?.[0].split("\n")[1]).toBe("2025-10-01 00:00\t10\t");
  });

  it("downloads the data of the range on screen as a CSV file named after the chart", async () => {
    renderChart("trend", "3m");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download data" }));
    expect(saved).toEqual([{ download: "Button adoption.csv", href: "blob:export" }]);
    const csv = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(csv.type).toBe("text/csv;charset=utf-8");
    expect((await readBlob(csv)).split("\r\n").slice(0, 2)).toEqual(["Committed (UTC),@example/web,Button · @example/ui", "2026-07-01 00:00,40,"]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("downloads an image of the range on screen named after the chart", async () => {
    const config = renderChart("trend", "3m");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download image" }));
    await waitFor(() => expect(saved).toEqual([{ download: "Button adoption.png", href: "blob:export" }]));
    expect(image.chartPng).toHaveBeenCalledExactlyOnceWith({
      title: TITLE,
      config,
      view: expect.objectContaining({ kind: "series" }),
      host: window.location.host,
      exportedAt: expect.any(Date),
    });
    const { view } = image.chartPng.mock.calls[0]?.[0] as { view: { series: CohortSeries[] } };
    expect(view.series.map((s) => s.points[0]?.t)).toEqual(["2026-06-30T12:00:00.000Z", "2026-08-01T00:00:00Z"]);
  });

  it("copies the chart's image as it's clicked, and says so", async () => {
    clipboard.write.mockResolvedValue(undefined);
    renderChart("bars");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy image" }));
    expect(clipboard.write).toHaveBeenCalledOnce();
    const [item] = clipboard.write.mock.calls[0]?.[0] ?? [];
    expect(item).toBeInstanceOf(FakeClipboardItem);
    expect(await (item as FakeClipboardItem).items["image/png"]).toEqual(await image.chartPng.mock.results[0]?.value);
    expect(await screen.findByText("Image copied")).toBeInTheDocument();
  });

  it.each([
    ["Download image", "Download image", () => image.chartPng.mockRejectedValueOnce(new Error("no canvas")), "Couldn't make the image. Try again."],
    ["Copy image", "Copy image", () => clipboard.write.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError")), "Couldn't copy the image. Try again."],
    ["Copy data", "Copy data", () => clipboard.writeText.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError")), "Couldn't copy the data. Try again."],
    ["Copy data on a page with no clipboard", "Copy data", () => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }), "Couldn't copy the data. Try again."],
  ])("says when %s fails", async (_, item, fail, message) => {
    fail();
    renderChart("trend");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: item }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
