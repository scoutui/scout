// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CohortSelector } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import { DashboardBuilder } from "@/components/dashboards/dashboard-builder";
import { pickOption } from "../helpers/select";

const actions = vi.hoisted(() => ({ preview: vi.fn(), picker: vi.fn(), save: vi.fn() }));
vi.mock("@/app/charts/dashboard-actions", () => ({
  previewDashboard: actions.preview, pickableForRepo: actions.picker, saveDashboard: actions.save,
}));

const readyPreview = { state: "ready", value: { kind: "series", series: [] } };
const readyPicker = { state: "ready", value: { components: [], packages: ["@sample/scoped"] } };

function builder() {
  return render(<DashboardBuilder libraryTags={[]} repos={["repo-a", "repo-b"]} components={[]} packages={["@sample/estate"]} deprecatedPackages={[]} />);
}

function selectRepo(repoId: string) {
  pickOption(screen.getByLabelText("Repos"), repoId || "All repos");
}

const seriesBox = () => screen.getByRole("searchbox", { name: "Add a series" });

function addSeries(name: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`^${name}`) }));
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  actions.preview.mockResolvedValue(readyPreview);
  actions.picker.mockResolvedValue(readyPicker);
});
afterEach(() => { vi.useRealTimers(); });

describe("chart builder read availability", () => {
  it("shows preparing history in the preview and loads it on its own", async () => {
    actions.preview.mockResolvedValueOnce({ state: "preparing", scans: [], retryable: true });
    builder();
    addSeries("Local components");
    const status = (await screen.findByText("Preparing scan data")).closest("[role=status]");
    expect(status?.closest(".panel")?.parentElement?.closest(".panel")).toBeNull();
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(await screen.findByText("Couldn't find the components in this chart.")).toBeInTheDocument();
    expect(screen.queryByText("Preparing scan data")).toBeNull();
  });

  it.each(["preparing", "failed"])("shows %s picker data instead of estate-wide options", async state => {
    const scans = state === "failed" ? [{ scanId: "scan-current", repoId: "repo-a", commit: "0123456789" }] : [];
    actions.picker.mockResolvedValueOnce({ state, scans, retryable: state === "preparing" });
    builder();
    selectRepo("repo-a");
    const title = await screen.findByText(state === "preparing" ? "Preparing scan data" : "Scan data couldn't be prepared");
    const status = title.closest(state === "preparing" ? "[role=status]" : "[role=alert]");
    expect(status).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Add a series" })).toBeNull();
    if (state === "failed") {
      expect(status).toHaveTextContent("repo-a · 0123456");
      selectRepo("repo-b");
    }
    if (state === "preparing") {
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(5_000); });
    }
    await screen.findByRole("searchbox", { name: "Add a series" });
    expect(screen.getByRole("checkbox", { name: /^@sample\s*\/scoped/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^@sample\s*\/estate/ })).toBeNull();
    expect(screen.queryByText(/Scan data|Preparing/)).toBeNull();
  });

  it.each(["preview", "picker"] as const)("makes an unexpected %s failure visible and retryable", async target => {
    actions[target].mockRejectedValueOnce(new Error("Database connection lost"));
    builder();
    if (target === "preview") addSeries("Local components");
    else selectRepo("repo-a");
    expect(await screen.findByRole("alert")).toHaveTextContent(target === "preview" ? "Couldn't load the preview." : "Couldn't load this repo's components.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    if (target === "preview") await screen.findByText("Couldn't find the components in this chart.");
    else await screen.findByRole("searchbox", { name: "Add a series" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a stale preview when a subsequent request is unavailable", async () => {
    builder();
    addSeries("Local components");
    await screen.findByText("Couldn't find the components in this chart.");
    actions.preview.mockResolvedValueOnce({ state: "failed", scans: [{ scanId: "scan-rebuild", repoId: "repo-a", commit: "0123456789" }], retryable: false });
    fireEvent.click(screen.getByRole("radio", { name: "% of uses" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("repo-a · 0123456");
    expect(screen.queryByText("Couldn't find the components in this chart.")).toBeNull();
  });

  it("clears old errors on a new request and ignores obsolete results after scope changes", async () => {
    actions.picker.mockResolvedValueOnce({ state: "failed", scans: [{ scanId: "old-failure", repoId: "old-failure", commit: "0123456789" }], retryable: false });
    builder();
    selectRepo("repo-a");
    await screen.findByText("old-failure · 0123456");
    let finish: ((result: unknown) => void) | undefined;
    actions.picker.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    selectRepo("repo-b");
    expect(screen.queryByText("old-failure · 0123456")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Series" })).getByRole("status")).toHaveTextContent("Loading…");
    selectRepo("");
    await act(async () => { finish?.({ state: "failed", scans: [{ scanId: "obsolete", repoId: "obsolete", commit: "0123456789" }], retryable: false }); });
    expect(screen.queryByText("obsolete · 0123456")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /^@sample\s*\/estate/ })).toBeInTheDocument();
  });

  it("ignores a pending preview after every series is removed", async () => {
    let finish: ((result: unknown) => void) | undefined;
    actions.preview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    builder();
    addSeries("Local components");
    addSeries("Local components");
    await act(async () => { finish?.({ state: "failed", scans: [{ scanId: "obsolete", repoId: "obsolete", commit: "0123456789" }], retryable: false }); });
    await waitFor(() => expect(screen.queryByText("Updating…")).toBeNull());
    expect(screen.queryByText("obsolete · 0123456")).toBeNull();
  });
});

describe("editing a saved chart", () => {
  it("opens with the saved chart and saves back to it", async () => {
    const config = { scope: { kind: "all" as const }, cohorts: [{ kind: "local" as const }], chartType: "bars" as const, metric: "share" as const };
    render(
      <DashboardBuilder
        libraryTags={[]}
        repos={["repo-a"]}
        components={[]}
        packages={[]} deprecatedPackages={[]}
        saved={{ id: "chart-1", name: "Button rollout", description: "Kept as it was", config, visibility: "private" }}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Button rollout");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Button rollout again" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ id: "chart-1", name: "Button rollout again", description: "Kept as it was", config, visibility: "private" }));
  });

  it("saves a copy of the saved chart as a new chart", async () => {
    const config = { scope: { kind: "all" as const }, cohorts: [{ kind: "local" as const }], chartType: "bars" as const, metric: "share" as const };
    render(
      <DashboardBuilder
        libraryTags={[]}
        repos={["repo-a"]}
        components={[]}
        packages={[]} deprecatedPackages={[]}
        saved={{ id: "chart-1", name: "Copy of Button rollout", description: null, config, visibility: "private" }}
        duplicate
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ name: "Copy of Button rollout", description: null, config, visibility: "private" }));
  });

  it("opens at the chart's saved range and saves the range picked in the preview", async () => {
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 9 + i, 1)).toISOString());
    const series = [{ cohortKey: "local", label: "Local components", color: "", points: months.map((t, i) => ({ t, value: i })) }];
    actions.preview.mockResolvedValue({ state: "ready", value: { kind: "series", series, coverage: { total: 1, repoIds: ["checkout"], points: months.map((t) => ({ t, repos: 1 })) } } });
    const config = { scope: { kind: "all" as const }, cohorts: [{ kind: "local" as const }], chartType: "trend" as const, metric: "count" as const, range: "6m" as const };
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} deprecatedPackages={[]} saved={{ id: "chart-1", name: "Local", description: null, config, visibility: "private" }} />);
    expect(await screen.findByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ config: { ...config, range: "3m" } })));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    const { range: _, ...all } = config;
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ config: all })));
    expect(actions.preview).toHaveBeenCalledTimes(1);
  });

  it("lists a series the chart leaves out as Unknown component, never by its id", async () => {
    const componentId = "3f1c9a0b7d2e4c65";
    const config = { scope: { kind: "all" as const }, cohorts: [{ kind: "component" as const, componentId }], chartType: "trend" as const, metric: "count" as const };
    const { container } = render(
      <DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} deprecatedPackages={[]} saved={{ id: "chart-1", name: "Button rollout", description: null, config, visibility: "private" }} />,
    );
    expect(container.innerHTML).not.toContain(componentId);
    expect(screen.queryByText("Unknown component")).toBeNull();
    expect(await screen.findByText("Unknown component")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove unknown component" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(componentId);
  });

  it.each([
    ["in another repo's latest scan", null, "Not in checkout"],
    ["only in older scans", "2026-01-01T00:00:00Z", null],
  ])("says which repo a left-out series isn't in only when it is %s", async (_, lastSeenAt, line) => {
    const app = { componentId: "app-admin", displayName: "App", packageName: "admin", disambiguator: null, deprecated: false, occurrences: 1, local: true, lastSeenAt };
    const config = { scope: { kind: "repo" as const, repoId: "checkout" }, cohorts: [{ kind: "component" as const, componentId: app.componentId }], chartType: "trend" as const, metric: "count" as const };
    render(<DashboardBuilder libraryTags={[]} repos={["admin", "checkout"]} components={[app]} packages={[]} deprecatedPackages={[]} saved={{ id: "chart-1", name: "App", description: null, config, visibility: "private" }} />);
    await waitFor(() => expect(actions.preview).toHaveBeenCalled());
    await act(async () => {});
    const notIn = (text: string | RegExp) => (_: string, el: Element | null) =>
      el?.tagName === "SPAN" && el.firstChild?.nodeType === Node.TEXT_NODE && (typeof text === "string" ? el.textContent === text : text.test(el.textContent ?? ""));
    if (line) expect(await screen.findByText(notIn(line))).toBeInTheDocument();
    else expect(screen.queryByText(notIn(/^Not in /))).toBeNull();
  });

  it("marks a deprecated series in the series list", async () => {
    const config = {
      scope: { kind: "all" as const },
      cohorts: [{ kind: "component" as const, componentId: "old" }, { kind: "component" as const, componentId: "new" }],
      chartType: "trend" as const,
      metric: "count" as const,
    };
    const points = [{ t: "2026-09-01T00:00:00Z", value: 10 }];
    actions.preview.mockResolvedValue({ state: "ready", value: { kind: "series", series: [
      { cohortKey: "component:old", label: "OldButton", color: "", role: "deprecated", points },
      { cohortKey: "component:new", label: "NewButton", color: "", points },
    ] } });
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Button rollout", description: null, config, visibility: "private" }} />);
    expect((await screen.findByText("deprecated")).closest("tr")).toHaveTextContent("OldButton");
    expect(screen.getAllByText("deprecated")).toHaveLength(1);
  });

  const oldButton = { componentId: "old", displayName: "OldButton", packageName: "@example/legacy", disambiguator: null, deprecated: true, occurrences: 1, local: false, lastSeenAt: null };
  const newButton = { componentId: "new", displayName: "NewButton", packageName: "@example/ui", disambiguator: null, deprecated: false, occurrences: 1, local: false, lastSeenAt: null };
  it.each([
    { kind: "component", selector: { kind: "component", componentId: "old" }, label: "OldButton", components: [oldButton, newButton], deprecatedPackages: [] },
    { kind: "package", selector: { kind: "package", packageName: "@example/legacy" }, label: "@example/legacy", components: [newButton], deprecatedPackages: ["@example/legacy"] },
  ] as const)("marks a deprecated $kind series in its colour, and colours the series after it, before the preview lands and after", async ({ selector, label, components, deprecatedPackages }) => {
    let finish: ((result: unknown) => void) | undefined;
    actions.preview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[...components]} packages={[]} deprecatedPackages={[...deprecatedPackages]} saved={savedWith([selector, { kind: "component", componentId: "new" }])} />);
    const row = (text: string) => screen.getAllByText(text).find((el) => el.closest("tr"))?.closest("tr") as HTMLElement;
    const expectKeyed = () => {
      expect(within(row(label)).getByText("deprecated")).toBeInTheDocument();
      expect(row(label).querySelector("svg")?.getAttribute("style")).toContain("var(--viz-deprecated)");
      expect(row("NewButton").querySelector("span[aria-hidden]")?.getAttribute("style")).toContain("var(--viz-primary)");
    };
    expectKeyed();
    const points = [{ t: "2026-09-01T00:00:00Z", value: 1 }];
    await act(async () => { finish?.({ state: "ready", value: { kind: "series", series: [
      { cohortKey: cohortKey(selector), label, color: "", role: "deprecated", points },
      { cohortKey: "component:new", label: "NewButton · @example/ui", color: "", points },
    ] } }); });
    await waitFor(() => expect(screen.queryByText("Updating…")).toBeNull());
    expectKeyed();
  });

  it("keys the series list as the chart colours it: in turn in saved order, starting again at the sixth", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const config = { scope: { kind: "all" as const }, cohorts: ids.map((componentId) => ({ kind: "component" as const, componentId })), chartType: "trend" as const, metric: "count" as const };
    actions.preview.mockResolvedValue({ state: "ready", value: { kind: "series", series: ids.map((id, n) => ({
      cohortKey: `component:${id}`,
      label: `Kit${id.toUpperCase()}`,
      color: "",
      points: [{ t: "2026-09-01T00:00:00Z", value: 1 }, { t: "2026-09-02T00:00:00Z", value: 10 + n }],
    })) } });
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Kits", description: null, config, visibility: "private" }} />);
    const swatch = async (label: string) => (await screen.findAllByText(label)).find((el) => el.closest("tr"))?.closest("tr")?.querySelector("span[aria-hidden]")?.getAttribute("style");
    expect(await swatch("KitA")).toContain("var(--viz-primary)");
    expect(await swatch("KitF")).toContain("var(--viz-primary)");
    expect(await swatch("KitH")).toContain("var(--viz-cat-3)");
  });
});

describe("chart details and saving", () => {
  const config = { scope: { kind: "all" as const }, cohorts: [{ kind: "local" as const }], chartType: "trend" as const, metric: "count" as const };

  it("saves the description, and no description when it is blank", async () => {
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} deprecatedPackages={[]} saved={{ id: "chart-1", name: "Kits", description: "Old text", config, visibility: "private" }} />);
    expect(screen.getByLabelText("Description")).toHaveValue("Old text");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  Deprecated parts of our kits.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ description: "Deprecated parts of our kits." })));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ description: null })));
  });

  it("cancels back to the chart being edited, or to the charts list for a new one", () => {
    const { unmount } = render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} deprecatedPackages={[]} saved={{ id: "chart 1", name: "Kits", description: null, config, visibility: "private" }} />);
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/charts/chart%201");
    unmount();
    builder();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/charts");
  });

  it("starts a new chart private, opens a saved chart on its own visibility, and saves the one picked", async () => {
    const { unmount } = builder();
    expect(within(screen.getByRole("group", { name: "Visibility" })).getByRole("radio", { name: "Private" })).toBeChecked();
    unmount();
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Kits", description: null, config, visibility: "everyone" }} />);
    expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: "everyone" })));
    fireEvent.click(screen.getByRole("radio", { name: "Private" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: "private" })));
  });

  it("keeps Metric on % of uses with Count unavailable while Stacked is chosen", () => {
    builder();
    expect(screen.getByText("Share of these series")).not.toBeVisible();
    fireEvent.click(within(screen.getByRole("group", { name: "Chart type" })).getByRole("radio", { name: "Stacked" }));
    expect(screen.getByRole("radio", { name: "% of uses" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Uses" })).toBeDisabled();
    expect(screen.getByText("Share of these series")).toBeVisible();
    expect(screen.getByRole("group", { name: "Metric" })).toHaveAccessibleDescription("Share of these series");
    fireEvent.click(screen.getByRole("radio", { name: "Trend" }));
    expect(screen.getByRole("radio", { name: "Uses" })).toBeChecked();
    expect(screen.getByText("Share of these series")).not.toBeVisible();
  });

  it("says what's missing beside it when saving without a name or a series, and moves focus there", () => {
    builder();
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(screen.getByRole("button", { name: "Save chart" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    expect(name).toHaveFocus();
    expect(name).toBeInvalid();
    expect(name).toHaveAccessibleDescription("Name the chart to save it.");
    expect(seriesBox()).toHaveAccessibleDescription("Add a series to save the chart.");

    fireEvent.change(name, { target: { value: "Kits" } });
    expect(name).toBeValid();
    expect(screen.queryByText("Name the chart to save it.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    expect(seriesBox()).toHaveFocus();
    addSeries("Local components");
    expect(screen.queryByText("Add a series to save the chart.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ name: "Kits", config: expect.objectContaining({ cohorts: [{ kind: "local" }] }) }));
  });
});

const vueKits = { id: "t-vue", label: "vue-ui-kits", color: "#888", rule: { glob: [], exact: ["ant-design-vue", "naive-ui"] } };
const reactKits = { id: "t-react", label: "react-ui-kits", color: "#888", rule: { glob: [], exact: ["@mui/material"] } };
const kitComponents = [
  { componentId: "a", displayName: "AButton", packageName: "ant-design-vue", disambiguator: null, deprecated: true, occurrences: 1, local: false, lastSeenAt: null },
  { componentId: "b", displayName: "ACard", packageName: "ant-design-vue", disambiguator: null, deprecated: false, occurrences: 1, local: false, lastSeenAt: null },
  { componentId: "c", displayName: "NButton", packageName: "naive-ui", disambiguator: null, deprecated: false, occurrences: 1, local: false, lastSeenAt: null },
];
const savedWith = (cohorts: CohortSelector[]) => ({
  id: "chart-1", name: "Old kits", description: null,
  config: { scope: { kind: "all" as const }, cohorts, chartType: "trend" as const, metric: "count" as const },
  visibility: "private" as const,
});
const said = (text: string) => screen.getAllByRole("status").filter((el) => el.textContent === text);
const firstCells = (table: HTMLElement) => within(table).getAllByRole("row").slice(1).map((row) => row.querySelector("td")?.textContent);

describe("series search", () => {
  it("shows the entry point beside components that share a name", () => {
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[
      { componentId: "b1", displayName: "Button", packageName: "@example/ui", disambiguator: "", deprecated: false, occurrences: 2, local: false, lastSeenAt: null },
      { componentId: "b2", displayName: "Button", packageName: "@example/ui", disambiguator: "dist/react/button/index", deprecated: false, occurrences: 1, local: false, lastSeenAt: null },
    ]} packages={[]} deprecatedPackages={[]} />);
    fireEvent.change(seriesBox(), { target: { value: "button" } });
    expect(screen.getByRole("checkbox", { name: /^Button\s*@example\s*\/ui$/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Button\s*@example\s*\/ui\s*…\/button\/index$/ })).toBeInTheDocument();
  });

  const sections = () => within(screen.getByRole("region", { name: "Series" })).getAllByRole("group").map((g) => g.querySelector("legend")?.textContent);

  it("lists Tags, Your code and Packages before typing, and while typing each match under its package, open until closed or the search changes", () => {
    const submit = { componentId: "s", displayName: "SubmitButton", packageName: "@example/app", disambiguator: null, deprecated: false, occurrences: 3, local: true, repoId: "react-app", lastSeenAt: null };
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[vueKits]} repos={[]} components={[...kitComponents, submit]} packages={["ant-design-vue", "naive-ui", "@example/app"]} />);
    expect(sections()).toEqual(["Tags", "Your code", "Packages"]);
    fireEvent.change(seriesBox(), { target: { value: "vue" } });
    expect(sections()).toEqual(["Tags", "Packages"]);
    fireEvent.change(seriesBox(), { target: { value: "button" } });
    expect(sections()).toEqual(["Packages"]);
    expect(screen.getByRole("checkbox", { name: /^Submit\s*Button/ })).toHaveAccessibleName(/^Submit\s*Button\s*Local · react-app$/);

    const disclosure = () => screen.getByRole("button", { name: "Show 1 of 2 components in ant-design-vue" });
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(disclosure().getAttribute("aria-controls") ?? "")).toContainElement(screen.getByRole("checkbox", { name: /^A\s*Button\s*ant-design-vue$/ }));
    expect(screen.queryByRole("checkbox", { name: /^ACard/ })).toBeNull();
    fireEvent.click(disclosure());
    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: /^AButton/ })).toBeNull();
    fireEvent.change(seriesBox(), { target: { value: "butto" } });
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a package's components under its row and closes them again, the package still added whole from its own row", () => {
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[vueKits]} repos={[]} components={kitComponents} packages={["ant-design-vue", "naive-ui"]} />);
    const disclosure = screen.getByRole("button", { name: "Show the 2 components in ant-design-vue" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(disclosure.getAttribute("aria-controls") ?? "")).toContainElement(screen.getByRole("checkbox", { name: "AButton ant-design-vue" }));
    const labels = screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent);
    const at = labels.indexOf("ant-design-vue");
    expect(labels.slice(at, at + 4)).toEqual(["ant-design-vue", "AButton ant-design-vue", "ACard ant-design-vue", "naive-ui"]);
    expect(sections()).toEqual(["Tags", "Your code", "Packages"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "ant-design-vue" }));
    expect(screen.getByRole("button", { name: "Remove ant-design-vue" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "AButton ant-design-vue" })).not.toBeChecked();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "AButton ant-design-vue" })).toBeNull();
  });

  it("lists an open package's five most used components, or its matches, then the rest from Show all, moving focus to the first of those", () => {
    const parts = Array.from({ length: 7 }, (_, i) => ({ componentId: `p${i}`, displayName: i === 0 ? "KitPart" : `Part${i}`, packageName: "@example/kit", disambiguator: null, deprecated: false, occurrences: i + 1, local: false, lastSeenAt: null }));
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={parts} packages={["@example/kit"]} />);
    const listed = (disclosure: HTMLElement) =>
      within(document.getElementById(disclosure.getAttribute("aria-controls") ?? "") as HTMLElement).getAllByRole("checkbox").map((c) => c.closest("label")?.textContent?.replace(" @example/kit", ""));
    const closed = screen.getByRole("button", { name: "Show the 7 components in @example/kit" });
    fireEvent.click(closed);
    expect(listed(closed)).toEqual(["Part6", "Part5", "Part4", "Part3", "Part2"]);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7 components in @example/kit" }));
    expect(listed(closed)).toEqual(["Part6", "Part5", "Part4", "Part3", "Part2", "Part1", "KitPart"]);
    expect(screen.getByRole("checkbox", { name: "Part1 @example/kit" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();

    fireEvent.change(seriesBox(), { target: { value: "kit" } });
    const matched = screen.getByRole("button", { name: "Show 1 of 7 components in @example/kit" });
    expect(listed(matched)).toEqual(["KitPart"]);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7 components in @example/kit" }));
    expect(listed(matched)).toEqual(["KitPart", "Part6", "Part5", "Part4", "Part3", "Part2", "Part1"]);
    expect(screen.getByRole("checkbox", { name: "Part6 @example/kit" })).toHaveFocus();
  });

  it("adds a series when its row is checked and removes it when unchecked, and says which once", () => {
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[vueKits]} repos={[]} components={kitComponents} packages={["ant-design-vue", "naive-ui"]} />);
    const tag = () => screen.getByRole("checkbox", { name: /^vue-ui-kits/ });
    fireEvent.click(tag());
    expect(tag()).toBeChecked();
    expect(screen.getByRole("button", { name: "Remove vue-ui-kits" })).toBeInTheDocument();
    expect(said("Added vue-ui-kits")).toHaveLength(1);

    fireEvent.change(seriesBox(), { target: { value: "acard" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /^ACard/ }));
    expect(said("Added ACard · ant-design-vue")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: /^ACard/ }));
    expect(screen.queryByRole("button", { name: "Remove ACard · ant-design-vue" })).toBeNull();
    expect(said("Removed ACard · ant-design-vue")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(tag()).toBeChecked();
  });
});

describe("series table", () => {
  const kit = (n: number) => Array.from({ length: n }, (_, i) => ({ componentId: `k${i}`, displayName: `Kit${i}`, packageName: "@example/kit", disambiguator: null, deprecated: false, occurrences: 1, local: false, lastSeenAt: null }));
  const drawn = (ids: string[]) => ids.map((id, i) => ({ cohortKey: `component:${id}`, label: `Kit${i} · @example/kit`, color: "", points: [{ t: "2026-09-01T00:00:00Z", value: i + 1 }] }));

  it("lists every added series under the preview in the order added, with — for any the preview hasn't drawn, sorts only once a heading is pressed, and removes the row pressed in that sort", async () => {
    const kits = kit(11);
    actions.preview.mockResolvedValue({ state: "ready", value: { kind: "series", series: drawn(kits.slice(0, 10).map((k) => k.componentId)) } });
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={kits} packages={["@example/kit"]} saved={savedWith(kits.map((k) => ({ kind: "component", componentId: k.componentId })))} />);
    const table = (await screen.findByText("10")).closest("table") as HTMLElement;
    expect(firstCells(table)).toEqual(kits.map((k) => `${k.displayName}@example/kit`));
    expect(within(table).getAllByRole("row").at(-1)).toHaveTextContent(/^Kit10@example\/kit—$/);
    expect(within(table).getAllByRole("columnheader").map((h) => h.getAttribute("aria-sort"))).toEqual([null, null, null]);
    expect(screen.queryByRole("searchbox", { name: /^Search series/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();

    fireEvent.click(within(table).getByRole("button", { name: "Uses" }));
    expect(within(table).getByRole("columnheader", { name: "Uses" })).toHaveAttribute("aria-sort", "descending");
    expect(firstCells(table)[0]).toBe("Kit9@example/kit");
    fireEvent.click(within(table).getByRole("button", { name: "Remove Kit9 · @example/kit" }));
    expect(within(table).getByRole("button", { name: "Remove Kit8 · @example/kit" })).toHaveFocus();
    expect(firstCells(table).slice(0, 2)).toEqual(["Kit8@example/kit", "Kit7@example/kit"]);
  });

  it("scrolls the row of a series just added into view inside the table", async () => {
    const kits = kit(11);
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={kits} packages={["@example/kit"]} saved={savedWith(kits.slice(0, 10).map((k) => ({ kind: "component", componentId: k.componentId })))} />);
    const area = (await screen.findByRole("table")).parentElement as HTMLElement;
    // The table shows 400px of its rows under 36px of headings, and the new row would land at 500px.
    const box = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
    const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === area) return box(0, 400);
      if (this.tagName === "THEAD") return box(0, 36);
      return this.tagName === "TR" && this.querySelector("[data-series=\"10\"]") ? box(500, 37) : box(0, 0);
    });
    try {
      fireEvent.change(seriesBox(), { target: { value: "kit10" } });
      fireEvent.click(screen.getByRole("checkbox", { name: /^Kit10/ }));
      expect(area.scrollTop).toBe(137);
    } finally {
      measured.mockRestore();
    }
  });

  it("removes a series from its row, moving focus to the next row's remove button, else the previous row's, else the search", async () => {
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={kitComponents} packages={[]} saved={savedWith(kitComponents.map((k) => ({ kind: "component", componentId: k.componentId })))} />);
    await waitFor(() => expect(actions.preview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Remove ACard · ant-design-vue" }));
    expect(screen.getByRole("button", { name: "Remove NButton · naive-ui" })).toHaveFocus();
    expect(said("Removed ACard · ant-design-vue")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove NButton · naive-ui" }));
    expect(screen.getByRole("button", { name: "Remove AButton · ant-design-vue" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Remove AButton · ant-design-vue" }));
    expect(seriesBox()).toHaveFocus();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says a removal again when it repeats the last one", async () => {
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={[]} packages={[]} saved={savedWith([{ kind: "component", componentId: "gone-1" }, { kind: "component", componentId: "gone-2" }])} />);
    const [first] = await screen.findAllByRole("button", { name: "Remove unknown component" });
    fireEvent.click(first as HTMLElement);
    const message = said("Removed unknown component")[0]?.firstChild;
    expect(message).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove unknown component" }));
    expect(said("Removed unknown component")[0]?.firstChild).not.toBe(message);
  });

  it("is the preview of a Table chart, with each row's remove button", async () => {
    const [a, b] = kitComponents;
    actions.preview.mockResolvedValue({ state: "ready", value: {
      kind: "table",
      points: [{ cohortKey: "component:a", label: "AButton · ant-design-vue", color: "", value: 4, componentCount: 1 }],
      series: [],
      coverage: { total: 1, repoIds: ["checkout"], points: [] },
      change: { "component:a": null },
    } });
    const saved = savedWith([{ kind: "component", componentId: "a" }, { kind: "component", componentId: "b" }]);
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[]} repos={[]} components={[a, b].filter((c) => c !== undefined)} packages={[]} saved={{ ...saved, config: { ...saved.config, chartType: "table" } }} />);
    const table = (await screen.findByText("4")).closest("table") as HTMLElement;
    expect(screen.getAllByRole("table")).toEqual([table]);
    const [, card] = within(table).getAllByRole("row").slice(1);
    expect(card).toHaveTextContent(/^ACardant-design-vue——$/);
    expect(within(card as HTMLElement).getByRole("button", { name: "Remove ACard · ant-design-vue" })).toBeInTheDocument();
  });
});

describe("series options", () => {
  it("narrows a library to its deprecated components from the row menu, leaving the line shown with the others until its row is pressed", async () => {
    const points = [{ t: "2026-09-01T00:00:00Z", value: 3 }, { t: "2026-09-02T00:00:00Z", value: 4 }];
    actions.preview.mockResolvedValue({ state: "ready", value: { kind: "series", series: [{ cohortKey: "tag:t-vue", label: "vue-ui-kits", color: "", points }], coverage: { total: 1, repoIds: ["checkout"], points: points.map(({ t }) => ({ t, repos: 1 })) } } });
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[vueKits]} repos={[]} components={kitComponents} packages={[]} saved={savedWith([{ kind: "tag", tagId: "t-vue" }])} />);
    const line = await screen.findByRole("button", { name: /^vue-ui-kits/, pressed: false });
    fireEvent.click(screen.getByRole("button", { name: "Options for vue-ui-kits" }));
    const item = await screen.findByRole("menuitemcheckbox", { name: /Only deprecated components/ });
    expect(line).toHaveAttribute("aria-pressed", "false");
    expect(item).toHaveTextContent("1 of 3 components in vue-ui-kits is deprecated");
    fireEvent.click(item);
    expect(await within(screen.getByRole("table")).findByText("deprecated only")).toBeInTheDocument();
    expect(line).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ cohorts: [{ kind: "tag", tagId: "t-vue", deprecatedOnly: true }] }),
    })));
  });

  it("offers no menu for a library with nothing deprecated", () => {
    render(<DashboardBuilder libraryTags={[reactKits]} repos={[]} components={[{ componentId: "m", displayName: "MButton", packageName: "@mui/material", disambiguator: null, deprecated: false, occurrences: 1, local: false, lastSeenAt: null }]} packages={[]} deprecatedPackages={[]} saved={savedWith([{ kind: "tag", tagId: "t-react" }])} />);
    expect(screen.queryByRole("button", { name: "Options for react-ui-kits" })).toBeNull();
  });

  it("switches deprecated only off on a saved series and keeps the option to turn it back on", async () => {
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[reactKits]} repos={[]} components={[]} packages={[]} saved={savedWith([{ kind: "tag", tagId: "t-react", deprecatedOnly: true }])} />);
    expect(screen.getByText("deprecated only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Options for react-ui-kits" }));
    const item = await screen.findByRole("menuitemcheckbox", { name: /Only deprecated components/ });
    expect(item).toHaveAttribute("aria-checked", "true");
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByRole("menuitemcheckbox", { name: /Only deprecated components/ })).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText("deprecated only")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ cohorts: [{ kind: "tag", tagId: "t-react" }] }),
    })));
  });

  it("offers only the libraries the chosen repo uses, and all of them again for All repos", async () => {
    actions.picker.mockResolvedValue({ state: "ready", value: { components: [kitComponents[2]], packages: ["naive-ui"] } });
    render(<DashboardBuilder deprecatedPackages={[]} libraryTags={[reactKits, vueKits]} repos={["repo-a"]} components={kitComponents} packages={[]} />);
    expect(screen.getByRole("checkbox", { name: /^react-ui-kits/ })).toBeInTheDocument();
    selectRepo("repo-a");
    await screen.findByRole("searchbox", { name: "Add a series" });
    expect(screen.getByRole("checkbox", { name: /^vue-ui-kits/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^react-ui-kits/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /^Local components/ })).toBeInTheDocument();
    selectRepo("");
    expect(await screen.findByRole("checkbox", { name: /^react-ui-kits/ })).toBeInTheDocument();
  });
});
