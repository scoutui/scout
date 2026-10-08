// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChartRange, ChartVisibility, CohortPoint, CohortSelector, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";

const actions = vi.hoisted(() => ({ setDashboardVisibility: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/charts/dashboard-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const image = vi.hoisted(() => ({ chartPng: vi.fn(async (_input: unknown) => new Blob(["png"], { type: "image/png" })) }));
vi.mock("@/lib/chart-png", () => image);

import { ChartExportProvider } from "@/components/dashboards/chart-export-context";
import { ChartMenu } from "@/components/dashboards/chart-menu";
import { LinkedDashboardChart } from "@/components/dashboards/dashboard-chart";
import { chartExportTable, toCsv, toTsv } from "@/lib/chart-export";
import { visibleView } from "@/lib/dashboard-chart-data";

const open = () => fireEvent.click(screen.getByRole("button", { name: "More actions" }));

describe("ChartMenu", () => {
  it.each([
    { visibility: "private" as const, item: "Share with everyone", absent: "Make private", next: "everyone" },
    { visibility: "everyone" as const, item: "Make private", absent: "Share with everyone", next: "private" },
  ])("offers $item on a $visibility chart and saves it as $next", async ({ visibility, item, absent, next }) => {
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility={visibility} exportSubmenu />);
    open();
    const offered = await screen.findByRole("menuitem", { name: item });
    expect(screen.queryByRole("menuitem", { name: absent })).toBeNull();
    fireEvent.click(offered);
    await waitFor(() => expect(actions.setDashboardVisibility).toHaveBeenCalledWith("chart 1", next));
  });

  it("offers no sharing to someone who can't change the chart", async () => {
    render(<ChartMenu id="chart 1" canDuplicate visibility={null} exportSubmenu />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Share with everyone" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Make private" })).toBeNull();
  });

  it("offers Duplicate only to someone who can make charts", async () => {
    const { unmount } = render(<ChartMenu id="chart 1" canDuplicate visibility={null} exportSubmenu />);
    open();
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toHaveAttribute("href", "/charts/new?from=chart%201");
    unmount();
    render(<ChartMenu id="chart 1" canDuplicate={false} visibility="private" exportSubmenu />);
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
  table: { kind: "table", points, series, coverage, change: {} },
};

const TITLE = "Button: adoption";

type Menu = { canDuplicate: boolean; visibility: ChartVisibility | null; exportSubmenu: boolean };

function renderChart(chartType: DashboardConfig["chartType"], range: ChartRange = "3m", menu: Menu = { canDuplicate: false, visibility: null, exportSubmenu: false }) {
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

async function exportItems(): Promise<string[]> {
  fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
  await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
  return within(screen.getAllByRole("menu")[1] as HTMLElement)
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

describe("ChartMenu export", () => {
  const clipboard = { write: vi.fn(async (_items: unknown[]) => {}), writeText: vi.fn(async (_text: string) => {}) };
  const saved: Array<{ download: string; href: string; onPage: boolean }> = [];

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 320));
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() });
    saved.length = 0;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ download: this.download, href: this.href, onPage: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clipboard.write.mockReset();
    clipboard.writeText.mockReset();
    image.chartPng.mockClear();
  });

  const ALL_ITEMS = ["Download PNG", "Download CSV", "Copy image", "Copy table"];

  it.each([
    ["trend", ALL_ITEMS],
    ["stacked-share", ALL_ITEMS],
    ["bars", ALL_ITEMS],
    ["table", ["Download CSV", "Copy table"]],
  ] as const)("lists a %s chart's export items in the menu itself without a submenu", async (chartType, items) => {
    renderChart(chartType);
    expect(await menuItems()).toEqual(items);
  });

  it("offers no Copy image where the browser can't copy images", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    renderChart("trend");
    expect(await menuItems()).toEqual(["Download PNG", "Download CSV", "Copy table"]);
  });

  it("offers no Copy image or Copy table where the page has no clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderChart("trend");
    expect(await menuItems()).toEqual(["Download PNG", "Download CSV"]);
  });

  it.each([
    ["trend", ALL_ITEMS],
    ["table", ["Download CSV", "Copy table"]],
  ] as const)("puts a %s chart's export items in an Export submenu, before sharing and Duplicate", async (chartType, items) => {
    renderChart(chartType, "3m", { canDuplicate: true, visibility: "private", exportSubmenu: true });
    expect(await menuItems()).toEqual(["Export", "Share with everyone", "Duplicate"]);
    expect(await exportItems()).toEqual(items);
  });

  it("downloads from the Export submenu", async () => {
    renderChart("trend", "3m", { canDuplicate: false, visibility: null, exportSubmenu: true });
    expect(await menuItems()).toEqual(["Export"]);
    await exportItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download CSV" }));
    expect(saved).toEqual([{ download: "Button adoption.csv", href: "blob:export", onPage: true }]);
  });

  it("renders nothing when it has no items", () => {
    const { container } = render(
      <ChartExportProvider title={TITLE}>
        <ChartMenu id="chart 1" canDuplicate={false} visibility={null} exportSubmenu />
      </ChartExportProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("copies the table of a range picked after the chart shows as tab-separated text, and says so", async () => {
    clipboard.writeText.mockResolvedValue(undefined);
    const config = renderChart("trend", "all");
    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy table" }));
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(toTsv(chartExportTable(config, views.trend, "3m")));
    expect(await screen.findByText("Table copied")).toBeInTheDocument();
  });

  it("downloads the table as a CSV file named after the chart, marked as UTF-8 for spreadsheets", async () => {
    const config = renderChart("trend", "3m");
    open();
    const item = await screen.findByRole("menuitem", { name: "Download CSV" });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fireEvent.click(item);
    expect(saved).toEqual([{ download: "Button adoption.csv", href: "blob:export", onPage: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(59_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:export");
    vi.useRealTimers();
    const csv = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(csv.type).toBe("text/csv;charset=utf-8");
    expect([...(await readBytes(csv)).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await readBlob(csv)).toBe(toCsv(chartExportTable(config, views.trend, "3m")));
  });

  it.each(["Download CSV", "Download PNG"])("clears a failure message once %s works", async (item) => {
    clipboard.writeText.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    renderChart("trend");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy table" }));
    expect(await screen.findByText("Couldn't copy the table. Try again.")).toBeInTheDocument();
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: item }));
    await waitFor(() => expect(screen.queryByText("Couldn't copy the table. Try again.")).toBeNull());
  });

  it("downloads an image of a range picked after the chart shows, named after the chart", async () => {
    const config = renderChart("trend", "all");
    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download PNG" }));
    await waitFor(() => expect(saved).toEqual([{ download: "Button adoption.png", href: "blob:export", onPage: true }]));
    expect(image.chartPng).toHaveBeenCalledExactlyOnceWith({
      title: TITLE,
      config,
      view: visibleView(config, views.trend, "3m").view,
      whole: visibleView(config, views.trend, "3m").view,
      host: window.location.host,
      exportedAt: expect.any(Date),
    });
  });

  it("hands the image the paths that tell same-named components apart", async () => {
    const config: DashboardConfig = { scope: { kind: "all" }, cohorts, chartType: "trend", metric: "count" };
    const paths = { "component:btn": "src/forms/Button.tsx" };
    render(
      <ChartExportProvider title={TITLE}>
        <ChartMenu id="chart 1" canDuplicate={false} visibility={null} exportSubmenu={false} />
        <LinkedDashboardChart config={config} view={views.trend} range="all" paths={paths} />
      </ChartExportProvider>,
    );
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download PNG" }));
    await waitFor(() => expect(image.chartPng).toHaveBeenCalledOnce());
    expect(image.chartPng.mock.calls[0]?.[0]).toMatchObject({ paths });
  });

  it("exports only the lines that match the table's search, colouring each as the whole chart does", async () => {
    const kits: CohortSeries[] = Array.from({ length: 9 }, (_, i) => ({
      cohortKey: `package:@example/kit-${i}`,
      label: `@example/kit-${i}`,
      color: "",
      points: [{ t: "2026-08-01T00:00:00Z", value: i + 1 }, { t: LATEST, value: i + 2 }],
    }));
    const config: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [...cohorts, ...kits.map((s) => ({ kind: "package" as const, packageName: s.label }))],
      chartType: "trend",
      metric: "count",
    };
    const whole: DashboardView = { kind: "series", series: [...series, ...kits], coverage };
    render(
      <ChartExportProvider title={TITLE}>
        <ChartMenu id="chart 1" canDuplicate={false} visibility={null} exportSubmenu={false} />
        <LinkedDashboardChart config={config} view={whole} range="all" />
      </ChartExportProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "button" } });
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download CSV" }));
    const csv = await readBlob(vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob);
    expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toBe("Committed (UTC),Button · @example/ui");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download PNG" }));
    await waitFor(() => expect(image.chartPng).toHaveBeenCalledOnce());
    const input = image.chartPng.mock.calls[0]?.[0] as { view: DashboardView; whole: DashboardView };
    expect(input.view.kind === "series" ? input.view.series.map((s) => s.cohortKey) : []).toEqual(["component:btn"]);
    expect(input.whole).toEqual(whole);
  });

  it("offers no image of a search whose lines have only one scan between them, and still offers the table", async () => {
    const kits: CohortSeries[] = Array.from({ length: 9 }, (_, i) => ({
      cohortKey: `package:@example/kit-${i}`,
      label: `@example/kit-${i}`,
      color: "",
      points: i === 0 ? [{ t: LATEST, value: 1 }] : [{ t: "2026-08-01T00:00:00Z", value: i }, { t: LATEST, value: i + 1 }],
    }));
    const config: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [...cohorts, ...kits.map((s) => ({ kind: "package" as const, packageName: s.label }))],
      chartType: "trend",
      metric: "count",
    };
    render(
      <ChartExportProvider title={TITLE}>
        <ChartMenu id="chart 1" canDuplicate={false} visibility={null} exportSubmenu={false} />
        <LinkedDashboardChart config={config} view={{ kind: "series", series: [...series, ...kits], coverage }} range="all" />
      </ChartExportProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kit-0" } });
    expect(await menuItems()).toEqual(["Download CSV", "Copy table"]);
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
    ["Download PNG", "Download PNG", () => image.chartPng.mockRejectedValueOnce(new Error("no canvas")), "Couldn't make the image. Try again."],
    ["Copy image", "Copy image", () => clipboard.write.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError")), "Couldn't copy the image. Try again."],
    ["Copy table", "Copy table", () => clipboard.writeText.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError")), "Couldn't copy the table. Try again."],
  ])("says when %s fails", async (_, item, fail, message) => {
    fail();
    renderChart("trend");
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: item }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
