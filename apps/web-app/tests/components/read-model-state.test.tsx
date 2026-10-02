// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import type { ScanFallbackNotice, UnavailableScan } from "@/lib/read-model-state";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const scan = (repoId: string): UnavailableScan => ({ scanId: `scan-${repoId}`, repoId, commit: "b20e5ea7f1c2d3e4" });

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  router.refresh.mockReset();
  setVisibility("visible");
});
afterEach(() => { vi.useRealTimers(); });

describe("read model availability", () => {
  it("keeps the page heading and reloads the page on its own while preparing, only while the tab is visible", () => {
    render(<ReadModelState state="preparing" scans={[]} retryable heading={{ title: "react-app", code: true, back: { href: "/repos", label: "Repos" } }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("react-app");
    expect(screen.getByRole("link", { name: "Repos" })).toHaveAttribute("href", "/repos");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Preparing scan data");
    expect(status).toHaveTextContent("This page loads on its own when it's ready.");
    expect(screen.queryByRole("list")).toBeNull();

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => { setVisibility("hidden"); vi.advanceTimersByTime(15_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => { setVisibility("visible"); });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("names the repo and commit of a failed scan, points to the retry guide and doesn't reload", () => {
    render(<ReadModelState state="failed" scans={[scan("react-app")]} retryable={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Scan data couldn't be prepared");
    expect(screen.getByText("Ask your dashboard administrator to retry it.")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("react-app · b20e5ea");
    expect(screen.getByRole("link", { name: "How to retry" }))
      .toHaveAttribute("href", "https://scoutui.dev/docs/guides/deploy-the-dashboard#retry-scans-that-failed-to-rebuild");
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each([
    [[scan("react-app")], "Scan this commit again to replace it."],
    [[scan("react-app"), scan("vue-app")], "Scan these commits again to replace them."],
  ])("asks for a new scan of commits that can't be read", (scans, line) => {
    render(<ReadModelState state="degraded" scans={scans} retryable={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Scan data can't be read");
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(scans.length);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says numbers may be out of date beside the numbers a page still shows", () => {
    render(<ReadModelState state="failed" scans={[scan("react-app")]} retryable={false} embedded besideNumbers />);
    expect(screen.getByText("Numbers may be out of date")).toBeInTheDocument();
    expect(screen.getByText("Some scan data couldn't be prepared. Ask your dashboard administrator to retry it.")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("re-runs a section's own request while preparing instead of reloading the page", () => {
    const refresh = vi.fn();
    render(<ReadModelState state="preparing" scans={[]} retryable embedded refresh={refresh} />);
    expect(screen.getByRole("status")).toHaveTextContent("This loads on its own when it's ready.");
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("skipped scans notice", () => {
  const fallback = (repoId: string, state: ScanFallbackNotice["state"], shown: boolean): ScanFallbackNotice => ({
    repoId, state, latest: { scanId: `latest-${repoId}`, repoId, commit: "c0ffee1a2b3c" },
    shown: shown ? { commit: "b20e5ea7f1c2d3e4", committedAt: "2026-09-30T12:00:00Z" } : null,
  });
  beforeEach(() => { vi.setSystemTime(new Date("2026-10-02T12:00:00Z")); });

  it("says on a repo's own page that the latest scan failed and which scan it shows, with the retry guide", () => {
    render(<SkippedScansNotice fallbacks={[fallback("storefront", "failed", true)]} ownPage />);
    expect(document.body).toHaveTextContent("The latest scan couldn't be prepared");
    expect(document.body).toHaveTextContent("Showing b20e5ea, committed 2d ago.");
    expect(document.body).not.toHaveTextContent("storefront");
    expect(screen.getByRole("link", { name: "How to retry" })).toHaveAttribute("href", expect.stringContaining("retry-scans-that-failed-to-rebuild"));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("names each repo across repos, and reloads the page while a newer scan is being prepared", () => {
    render(<SkippedScansNotice fallbacks={[fallback("storefront", "preparing", true), fallback("admin", "degraded", true)]} />);
    expect(screen.getByRole("status")).toHaveTextContent("storefront's latest scan is being prepared");
    expect(screen.getByRole("status")).toHaveTextContent("Showing b20e5ea, committed 2d ago.");
    expect(document.body).toHaveTextContent("admin's latest scan can't be read");
    expect(document.body).toHaveTextContent("Showing b20e5ea, committed 2d ago. Scan c0ffee1 again to replace it.");
    expect(screen.queryByRole("link", { name: "How to retry" })).toBeNull();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("names a repo left out because its latest scan failed, and one not shown yet", () => {
    render(<SkippedScansNotice fallbacks={[fallback("storefront", "failed", false), fallback("checkout", "preparing", false)]} />);
    expect(document.body).toHaveTextContent("storefront is left out");
    expect(document.body).toHaveTextContent("Its latest scan couldn't be prepared.");
    expect(screen.getByRole("status")).toHaveTextContent("checkout isn't shown yet");
    expect(screen.getByRole("status")).toHaveTextContent("Its latest scan is being prepared.");
    expect(screen.getByRole("link", { name: "How to retry" })).toBeInTheDocument();
  });

  it.each([[4, "1 more repo"], [5, "2 more repos"]] as const)("shows three repo rows and folds the rest of %i into a disclosure", (count, more) => {
    render(<SkippedScansNotice fallbacks={Array.from({ length: count }, (_, index) => fallback(`repo-${index}`, "failed", true))} />);
    const disclosure = screen.getByText(more).closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure?.textContent).toContain(`repo-${count - 1}'s latest scan`);
    expect(disclosure?.textContent).not.toContain("repo-2's latest scan");
    expect(screen.getAllByText(/'s latest scan couldn't be prepared/)).toHaveLength(count);
  });

  it("counts the scans left out of a trend in one band per state", () => {
    const gap = (repoId: string, state: ScanFallbackNotice["state"]) => ({ ...scan(repoId), state });
    render(<SkippedScansNotice gaps={[gap("storefront", "failed"), gap("checkout", "failed"), gap("admin", "degraded")]} />);
    const [failed, degraded] = screen.getAllByRole("list");
    expect(document.body).toHaveTextContent("2 scans are left out");
    expect(document.body).toHaveTextContent("They couldn't be prepared.");
    expect([...(failed?.children ?? [])].map(item => item.textContent)).toEqual(["storefront · b20e5ea", "checkout · b20e5ea"]);
    expect(document.body).toHaveTextContent("1 scan is left out");
    expect(document.body).toHaveTextContent("It can't be read. Scan this commit again to replace it.");
    expect(degraded).toHaveTextContent("admin · b20e5ea");
  });
});
