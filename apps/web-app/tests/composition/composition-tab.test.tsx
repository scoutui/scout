// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentDetail, CompositionGraph } from "@scoutui/web-shared";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CompositionTab } from "@/components/component-detail/composition/composition-tab";
import { graph, node } from "./graph-fixtures";

vi.mock("next/navigation", async () => (await import("../helpers/search-params-mock")).searchParamsNavigationMock());

const detail = { componentId: "F", repoId: "r/x", displayName: "F" } as unknown as ComponentDetail;

// F is rendered directly by d0..d11, d0 using it most, so d10 and d11 fold
// into "+2 more". d0 is also rendered by d1 (as near F as d0) and by p0, one
// step further out. F renders kid.
const tabGraph: CompositionGraph = graph(
  [node("F"), node("p0"), node("kid"), ...Array.from({ length: 12 }, (_, i) => node(`d${i}`))],
  [
    ...Array.from({ length: 12 }, (_, i) => [`d${i}`, "F", 12 - i] as [string, string, number]),
    ["d1", "d0", 1],
    ["p0", "d0", 1],
    ["F", "kid", 2],
  ],
);

const renderTab = (g: CompositionGraph = tabGraph) =>
  render(
    <ThemeProvider>
      <CompositionTab detail={detail} graph={g} />
    </ThemeProvider>,
  );

const param = (name: string) => new URLSearchParams(window.location.search).get(name);
const box = (name: string) => screen.findByRole("button", { name: new RegExp(`^${name}, `) });

beforeEach(() => {
  window.history.replaceState(null, "", "http://localhost:3000/x?scan=s1");
});

describe("CompositionTab", () => {
  it("selects a box into ?pin= with what renders it, and clears both on a second click, keeping other parameters", async () => {
    renderTab();
    fireEvent.click(await box("d0"));
    expect(param("pin")).toBe("up:d0");
    expect(param("scan")).toBe("s1");
    expect(await box("d0")).toHaveAttribute("aria-pressed", "true");
    expect(within(await box("d0")).getByTitle("d0")).toBeInTheDocument();
    expect(await box("p0")).toHaveAccessibleName(/^p0, local, src\/p0\.tsx\. 2 steps from F\.$/);
    fireEvent.click(await box("d0"));
    expect(param("pin")).toBeNull();
    expect(param("scan")).toBe("s1");
    await waitFor(() => expect(screen.queryByRole("button", { name: /^p0, / })).not.toBeInTheDocument());
  });

  it.each([
    ["a box on the diagram", "up:d0", "true"],
    ["a malformed value", "d0", "false"],
    ["a component this graph doesn't have", "up:gone", "false"],
  ])("restores ?pin= on load: %s", async (_, pin, pressed) => {
    window.history.replaceState(null, "", `http://localhost:3000/x?pin=${pin}`);
    renderTab();
    expect(await box("d0")).toHaveAttribute("aria-pressed", pressed);
  });

  it("writes the selected route out, links to the component, and clears from the bar", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?pin=up:p0");
    renderTab();
    expect(await screen.findByText("Showing the route to p0")).toBeInTheDocument();
    expect(screen.getByText("2 steps away")).toBeInTheDocument();
    expect(screen.getByText("· src/p0.tsx")).toBeInTheDocument();
    expect(screen.getByText("p0 renders d0 once, and d0 renders F 12 times. Nothing in this repo renders p0.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open p0" })).toHaveAttribute("href", "/repos/r%2Fx/components/p0?tab=composition");
    fireEvent.click(screen.getByRole("button", { name: "Clear the selection (Escape)" }));
    expect(param("pin")).toBeNull();
    expect(await screen.findByText("Route cleared")).toBeInTheDocument();
  });

  it("clears the selection on Escape, but Escape in Find only closes Find", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?pin=up:d0");
    renderTab();
    const find = await screen.findByRole("combobox");
    fireEvent.focus(find);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(find, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(param("pin")).toBe("up:d0");
    fireEvent.keyDown(await box("d0"), { key: "Escape" });
    expect(param("pin")).toBeNull();
  });

  it("closes Find when focus leaves it, and keeps it open while focus moves into its list", async () => {
    renderTab();
    const find = await screen.findByRole("combobox");
    fireEvent.focus(find);
    fireEvent.blur(find, { relatedTarget: screen.getByRole("listbox") });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(find, { relatedTarget: await box("d0") });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(find).toHaveAttribute("aria-expanded", "false");
  });

  it("moves focus to the route's first step when the bar clears the route", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?pin=up:p0");
    renderTab();
    const clear = await screen.findByRole("button", { name: "Clear the selection (Escape)" });
    clear.focus();
    fireEvent.click(clear);
    await waitFor(() => expect(screen.getByRole("button", { name: /^d0, / })).toHaveFocus());
  });

  it.each([
    ["the +N more", "pin=up:q0", () => screen.getByRole("button", { name: "Show 2 more components that render F" })],
    ["the open list's filter", "list=up:F&pin=up:q0", () => screen.getByRole("textbox", { name: "Filter the 2 components" })],
  ])("moves focus to %s a cleared route's first step folds into", async (_, query, target) => {
    window.history.replaceState(null, "", `http://localhost:3000/x?${query}`);
    renderTab(
      graph(
        [node("F"), node("q0"), ...Array.from({ length: 12 }, (_, i) => node(`d${i}`))],
        [...Array.from({ length: 12 }, (_, i) => [`d${i}`, "F", 12 - i] as [string, string, number]), ["q0", "d11", 1]],
      ),
    );
    const q0 = await box("q0");
    q0.focus();
    fireEvent.keyDown(q0, { key: "Escape" });
    expect(param("pin")).toBeNull();
    await waitFor(() => expect(target()).toHaveFocus());
  });

  it("keeps focus on a box that stays when Escape clears the route", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?pin=up:d0");
    renderTab();
    const d1 = await box("d1");
    d1.focus();
    fireEvent.keyDown(d1, { key: "Escape" });
    expect(param("pin")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(await box("d1")).toHaveFocus();
  });

  it("opens +N more as a list, filters it, and selects the row picked", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Show 2 more components that render F" }));
    expect(param("list")).toBe("up:F");
    const filter = await screen.findByRole("textbox", { name: "Filter the 2 components" });
    await waitFor(() => expect(filter).toHaveFocus());
    fireEvent.change(filter, { target: { value: "d11" } });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(screen.getByText("zzz").closest("li")).toHaveTextContent(/^No matches for “zzz”\.$/);
    fireEvent.change(filter, { target: { value: "d11" } });
    fireEvent.click(screen.getByRole("button", { name: /^d11, src\/d11\.tsx, 1 use\./ }));
    expect(param("bring")).toBe("up:d11");
    expect(param("pin")).toBe("up:d11");
    expect(await box("d11")).toHaveAttribute("aria-pressed", "true");
  });

  it("closes an open list on Escape and keeps the selection", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?list=up:F&pin=up:d0");
    renderTab();
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "Filter the 2 components" }), { key: "Escape" });
    expect(param("list")).toBeNull();
    expect(param("pin")).toBe("up:d0");
  });

  it("selects the component picked in Find", async () => {
    renderTab();
    const find = await screen.findByRole("combobox");
    fireEvent.change(find, { target: { value: "kid" } });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /kid/ }));
    expect(param("pin")).toBe("down:kid");
  });


  it("draws a component on both sides when it renders and is rendered by the focus, and selects each side on its own", async () => {
    renderTab(graph([node("F"), node("Z")], [["Z", "F", 1], ["F", "Z", 3]]));
    fireEvent.click(await screen.findByRole("button", { name: /^Z, .*Renders F once\./ }));
    expect(param("pin")).toBe("up:Z");
    fireEvent.click(await screen.findByRole("button", { name: /^Z, .*F renders it 3 times\./ }));
    expect(param("pin")).toBe("down:Z");
  });

  it("lights a hovered box's route without dimming the rest, and dims what's off a selected route but not what it opened or an open list", async () => {
    const { container } = renderTab();
    const shell = (id: string) => container.querySelector(`.react-flow__node[data-id="${id}"] > *`) as HTMLElement;
    await box("d0");
    fireEvent.mouseEnter(container.querySelector('.react-flow__node[data-id="up:d0"]') as Element);
    await waitFor(() => expect(shell("up:d0")).toHaveClass("border-foreground/60"));
    expect(shell("up:d1")).not.toHaveClass("text-muted-foreground");
    expect(screen.getByText("+2 more")).toHaveClass("text-foreground");
    fireEvent.click(await box("d0"));
    await waitFor(() => expect(shell("up:d1")).toHaveClass("text-muted-foreground"));
    expect(shell("up:d0")).not.toHaveClass("text-muted-foreground");
    expect(shell("up:p0")).not.toHaveClass("text-muted-foreground");
    expect(screen.getByText("+2 more")).not.toHaveClass("text-foreground");
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more components that render F" }));
    expect(await screen.findByRole("group", { name: "2 more render F" })).not.toHaveClass("text-muted-foreground");
  });

  it("Reset closes everything opened and clears the selection", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?scan=s1&list=up:F&bring=up:d11&pin=up:p0");
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    expect(window.location.search).toBe("?scan=s1");
  });

  describe("on a phone", () => {
    beforeEach(() => {
      const real = window.matchMedia;
      vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ ...real(q), matches: q === "(max-width: 639px)" }));
    });
    afterEach(() => vi.restoreAllMocks());

    it("opens on the list, and picking from it shows the route on the diagram", async () => {
      const { container } = renderTab();
      expect(await screen.findByRole("listbox")).toBeInTheDocument();
      expect(container.querySelector(".react-flow")).toBeNull();
      fireEvent.click(screen.getByRole("option", { name: /^d0/ }));
      expect(param("pin")).toBe("up:d0");
      expect(await box("d0")).toHaveAttribute("aria-pressed", "true");
    });
  });
});
