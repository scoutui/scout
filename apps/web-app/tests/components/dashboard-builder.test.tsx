// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CohortSelector } from "@scoutui/web-shared";
import { DashboardBuilder } from "@/components/dashboards/dashboard-builder";

const actions = vi.hoisted(() => ({ preview: vi.fn(), picker: vi.fn(), save: vi.fn() }));
vi.mock("@/app/charts/dashboard-actions", () => ({
  previewDashboard: actions.preview, pickableForRepo: actions.picker, saveDashboard: actions.save,
}));

const readyPreview = { state: "ready", value: { kind: "series", series: [] } };
const readyPicker = { state: "ready", value: { components: [], packages: ["@sample/scoped"] } };

function builder() {
  return render(<DashboardBuilder libraryTags={[]} repos={["repo-a", "repo-b"]} components={[]} packages={["@sample/estate"]} />);
}

function selectRepo(repoId: string) {
  fireEvent.change(screen.getByLabelText("Repos"), { target: { value: repoId } });
}

const seriesBox = () => screen.getByRole("combobox", { name: "Add a series" });

function addSeries(name: string) {
  fireEvent.click(seriesBox());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
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
    expect(screen.queryByRole("combobox", { name: "Add a series" })).toBeNull();
    if (state === "failed") {
      expect(status).toHaveTextContent("repo-a · 0123456");
      selectRepo("repo-b");
    }
    if (state === "preparing") {
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(5_000); });
    }
    await screen.findByRole("combobox", { name: "Add a series" });
    fireEvent.click(seriesBox());
    expect(screen.getByRole("option", { name: /^@sample\s*\/scoped/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^@sample\s*\/estate/ })).toBeNull();
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
    else await screen.findByRole("combobox", { name: "Add a series" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a stale preview when a subsequent request is unavailable", async () => {
    builder();
    addSeries("Local components");
    await screen.findByText("Couldn't find the components in this chart.");
    actions.preview.mockResolvedValueOnce({ state: "failed", scans: [{ scanId: "scan-rebuild", repoId: "repo-a", commit: "0123456789" }], retryable: false });
    fireEvent.click(screen.getByRole("button", { name: "% of uses" }));
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
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    selectRepo("");
    await act(async () => { finish?.({ state: "failed", scans: [{ scanId: "obsolete", repoId: "obsolete", commit: "0123456789" }], retryable: false }); });
    expect(screen.queryByText("obsolete · 0123456")).toBeNull();
    fireEvent.click(seriesBox());
    expect(screen.getByRole("option", { name: /^@sample\s*\/estate/ })).toBeInTheDocument();
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
        packages={[]}
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
        packages={[]}
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
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Local", description: null, config, visibility: "private" }} />);
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
      <DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Button rollout", description: null, config, visibility: "private" }} />,
    );
    expect(container.innerHTML).not.toContain(componentId);
    expect(screen.queryByText("Unknown component")).toBeNull();
    expect(await screen.findByText("Unknown component")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove unknown component" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(componentId);
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
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Button rollout", description: null, config, visibility: "private" }} />);
    expect((await screen.findByText("deprecated")).closest("li")).toHaveTextContent("OldButton");
    expect(screen.getAllByText("deprecated")).toHaveLength(1);
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
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Kits", description: null, config, visibility: "private" }} />);
    const swatch = async (label: string) => (await screen.findAllByText(label)).find((el) => el.closest("li"))?.closest("li")?.querySelector("span[aria-hidden]")?.getAttribute("style");
    expect(await swatch("KitA")).toContain("var(--viz-primary)");
    expect(await swatch("KitF")).toContain("var(--viz-primary)");
    expect(await swatch("KitH")).toContain("var(--viz-cat-3)");
  });
});

describe("chart details and saving", () => {
  const config = { scope: { kind: "all" as const }, cohorts: [{ kind: "local" as const }], chartType: "trend" as const, metric: "count" as const };

  it("saves the description, and no description when it is blank", async () => {
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Kits", description: "Old text", config, visibility: "private" }} />);
    expect(screen.getByLabelText("Description")).toHaveValue("Old text");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  Deprecated parts of our kits.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ description: "Deprecated parts of our kits." })));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ description: null })));
  });

  it("cancels back to the chart being edited, or to the charts list for a new one", () => {
    const { unmount } = render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart 1", name: "Kits", description: null, config, visibility: "private" }} />);
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/charts/chart%201");
    unmount();
    builder();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/charts");
  });

  it("starts a new chart private, opens a saved chart on its own visibility, and saves the one picked", async () => {
    const { unmount } = builder();
    expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Kits", description: null, config, visibility: "everyone" }} />);
    expect(screen.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: "everyone" })));
    fireEvent.click(screen.getByRole("button", { name: "Private" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: "private" })));
  });

  it("keeps Metric on % of uses with Count unavailable while Stacked is chosen", () => {
    builder();
    expect(screen.getByText("Share of these series")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stacked" }));
    expect(screen.getByRole("button", { name: "% of uses" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Uses" })).toBeDisabled();
    expect(screen.getByText("Share of these series")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Trend" }));
    expect(screen.getByRole("button", { name: "Uses" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Share of these series")).not.toBeVisible();
  });

  it("can't save without a name, and says so", () => {
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[]} packages={[]} saved={{ id: "chart-1", name: "Kits", description: null, config, visibility: "private" }} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save chart" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save chart" })).toHaveAccessibleDescription("Name the chart to save it.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kits" } });
    expect(screen.getByRole("button", { name: "Save chart" })).toBeEnabled();
    expect(screen.queryByText("Name the chart to save it.")).toBeNull();
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
const spokenDeprecated = () => screen.getAllByText("deprecated").filter((el) => !el.closest('[aria-hidden="true"]'));

describe("series search", () => {
  it("shows the entry point beside components that share a name", () => {
    render(<DashboardBuilder libraryTags={[]} repos={[]} components={[
      { componentId: "b1", displayName: "Button", packageName: "@example/ui", disambiguator: "", deprecated: false, occurrences: 2, local: false, lastSeenAt: null },
      { componentId: "b2", displayName: "Button", packageName: "@example/ui", disambiguator: "dist/react/button/index", deprecated: false, occurrences: 1, local: false, lastSeenAt: null },
    ]} packages={[]} />);
    fireEvent.change(seriesBox(), { target: { value: "button" } });
    expect(screen.getByRole("option", { name: /^Button\s*@example\s*\/ui$/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Button\s*@example\s*\/ui\s*…\/button\/index$/ })).toBeInTheDocument();
  });
});

describe("series options", () => {
  it("narrows a library to its deprecated components from the row menu", async () => {
    render(<DashboardBuilder libraryTags={[vueKits]} repos={[]} components={kitComponents} packages={[]} saved={savedWith([{ kind: "tag", tagId: "t-vue" }])} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for vue-ui-kits" }));
    const item = await screen.findByRole("menuitemcheckbox", { name: /Only deprecated components/ });
    expect(item).toHaveTextContent("1 of 3 components in vue-ui-kits is deprecated");
    fireEvent.click(item);
    expect(await screen.findByText((_, el) => el?.textContent === "· deprecated")).toBeInTheDocument();
    expect(spokenDeprecated()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ cohorts: [{ kind: "tag", tagId: "t-vue", deprecatedOnly: true }] }),
    })));
  });

  it("offers no menu for a library with nothing deprecated", () => {
    render(<DashboardBuilder libraryTags={[reactKits]} repos={[]} components={[{ componentId: "m", displayName: "MButton", packageName: "@mui/material", disambiguator: null, deprecated: false, occurrences: 1, local: false, lastSeenAt: null }]} packages={[]} saved={savedWith([{ kind: "tag", tagId: "t-react" }])} />);
    expect(screen.queryByRole("button", { name: "Options for react-ui-kits" })).toBeNull();
  });

  it("switches deprecated only off on a saved series and keeps the option to turn it back on", async () => {
    render(<DashboardBuilder libraryTags={[reactKits]} repos={[]} components={[]} packages={[]} saved={savedWith([{ kind: "tag", tagId: "t-react", deprecatedOnly: true }])} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for react-ui-kits" }));
    const item = await screen.findByRole("menuitemcheckbox", { name: /Only deprecated components/ });
    expect(item).toHaveAttribute("aria-checked", "true");
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByRole("menuitemcheckbox", { name: /Only deprecated components/ })).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText((_, el) => el?.textContent === "· deprecated")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ cohorts: [{ kind: "tag", tagId: "t-react" }] }),
    })));
  });

  it("says deprecated once to screen readers when the preview marks a deprecated-only series deprecated", async () => {
    actions.preview.mockResolvedValue({ state: "ready", value: { kind: "series", series: [
      { cohortKey: "tag:t-react", label: "react-ui-kits", color: "", role: "deprecated", points: [{ t: "2026-09-01T00:00:00Z", value: 4 }] },
    ] } });
    render(<DashboardBuilder libraryTags={[reactKits]} repos={[]} components={[]} packages={[]} saved={savedWith([{ kind: "tag", tagId: "t-react", deprecatedOnly: true }])} />);
    await waitFor(() => expect(screen.getAllByText("deprecated")).toHaveLength(2));
    expect(spokenDeprecated()).toHaveLength(1);
  });

  it("offers only the libraries the chosen repo uses, and all of them again for All repos", async () => {
    actions.picker.mockResolvedValue({ state: "ready", value: { components: [kitComponents[2]], packages: ["naive-ui"] } });
    render(<DashboardBuilder libraryTags={[reactKits, vueKits]} repos={["repo-a"]} components={kitComponents} packages={[]} />);
    fireEvent.click(seriesBox());
    expect(screen.getByRole("option", { name: /^react-ui-kits/ })).toBeInTheDocument();
    selectRepo("repo-a");
    fireEvent.click(await screen.findByRole("combobox", { name: "Add a series" }));
    expect(screen.getByRole("option", { name: /^vue-ui-kits/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^react-ui-kits/ })).toBeNull();
    expect(screen.getByRole("option", { name: /^Local components/ })).toBeInTheDocument();
    selectRepo("");
    fireEvent.click(seriesBox());
    expect(await screen.findByRole("option", { name: /^react-ui-kits/ })).toBeInTheDocument();
  });
});
