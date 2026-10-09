// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentDetail, CompositionGraph } from "@scoutui/web-shared";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CompositionTab } from "@/components/component-detail/composition/composition-tab";
import { graph, node } from "./graph-fixtures";

vi.mock("next/navigation", async () => (await import("../helpers/search-params-mock")).searchParamsNavigationMock());

const detail = { componentId: "F", repoId: "r/x", displayName: "F" } as unknown as ComponentDetail;

// Pages P0 (app/a/page.tsx) and P1 (app/b/page.tsx), both named Page:
// P0 → Shell → Card → F, P1 → Card, Card renders F 5 times, Solo renders F
// once and nothing renders Solo, F → Kid → Leaf. d0..d11 render F, d0 most;
// nothing renders them. d1 is an external, deprecated component.
const tabGraph: CompositionGraph = graph(
  [
    node("F"),
    node("Card"),
    node("Shell"),
    node("Solo"),
    node("Kid"),
    node("Leaf"),
    node("P0", { displayName: "Page", filePath: "app/a/page.tsx" }),
    node("P1", { displayName: "Page", filePath: "app/b/page.tsx" }),
    ...Array.from({ length: 12 }, (_, i) =>
      node(`d${i}`, i === 1 ? { scope: "external", deprecated: true, packageName: "@x/ui", filePath: null } : {}),
    ),
  ],
  [
    ["P0", "Shell"],
    ["Shell", "Card"],
    ["Card", "F", 5],
    ["P1", "Card"],
    ["Solo", "F"],
    ["F", "Kid"],
    ["Kid", "Leaf"],
    ...Array.from({ length: 12 }, (_, i) => [`d${i}`, "F", 12 - i] as [string, string, number]),
  ],
);

const renderTab = (g: CompositionGraph = tabGraph) =>
  render(
    <ThemeProvider>
      <CompositionTab detail={detail} graph={g} />
    </ThemeProvider>,
  );

const param = (name: string) => new URLSearchParams(window.location.search).get(name);
const list = (name: RegExp) => screen.getByRole("list", { name });
const rowsOf = (name: RegExp) => within(list(name)).getAllByRole("listitem");
/** A row by its name as a browser reads it: jsdom has no layout, so it puts a space before each comma. */
const row = (listName: RegExp, name: RegExp) =>
  within(list(listName)).getByRole("button", { name: (accessible) => name.test(accessible.replace(/ ,/g, ",")) });

beforeEach(() => {
  window.history.replaceState(null, "", "http://localhost:3000/x?scan=s1");
});

describe("CompositionTab", () => {
  it("lists every top-level component and every direct renderer in full, and what it renders", () => {
    renderTab();
    expect(rowsOf(/^Top level · 15$/)).toHaveLength(15);
    expect(rowsOf(/^Directly · 14$/)).toHaveLength(14);
    expect(rowsOf(/^Renders · 1$/)).toHaveLength(1);
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(screen.getByText("17 render F · F renders 2")).toBeInTheDocument();
  });

  it("picks a top-level row into ?top= and draws its route as boxes that each open their page", () => {
    renderTab();
    fireEvent.click(row(/^Top level/, /^Page, b/));
    fireEvent.click(row(/^Top level/, /^Page, a/));
    expect(param("top")).toBe("P0");
    expect(param("scan")).toBe("s1");
    expect(row(/^Top level/, /^Page, a/)).toHaveAttribute("aria-pressed", "true");
    const route = screen.getByRole("list", { name: "Route" });
    expect(within(route).getAllByRole("listitem")).toHaveLength(1);
    expect(within(route).getByRole("link", { name: "Open Shell" })).toHaveAttribute(
      "href",
      "/repos/r%2Fx/components/Shell?tab=composition",
    );
    fireEvent.click(row(/^Top level/, /^Page, a/));
    expect(param("top")).toBeNull();
    expect(screen.queryByRole("list", { name: "Route" })).toBeNull();
  });

  it("folds what it renders into a count while a route with steps is drawn, and opens it on request", () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?top=P1");
    renderTab();
    expect(rowsOf(/^Renders · 1$/)).toHaveLength(1);
    fireEvent.click(row(/^Top level/, /^Page, a/));
    expect(screen.queryByRole("list", { name: /^Renders/ })).toBeNull();
    const fold = screen.getByRole("button", { name: "Renders · 1" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fold);
    expect(rowsOf(/^Renders · 1$/)).toHaveLength(1);
    expect(within(list(/^Renders/)).getByRole("link", { name: "Open Kid" })).toHaveFocus();
  });

  it.each([
    ["a route with steps between", "top=P0", 4],
    ["a top-level component that renders it directly", "top=Solo", 2],
  ])("lights the lines of %s, drawn after the faint ones", (_, query, lit) => {
    window.history.replaceState(null, "", `http://localhost:3000/x?${query}`);
    renderTab();
    const paths = [...document.querySelectorAll("svg[data-connectors] path")];
    const strokes = paths.map((p) => p.getAttribute("stroke"));
    expect(strokes.filter((s) => s === "var(--foreground)")).toHaveLength(lit);
    expect(strokes.slice(-lit).every((s) => s === "var(--foreground)")).toBe(true);
  });

  it("picks a direct renderer into ?pin=up: and narrows the top level to the routes through it, until Show all", () => {
    renderTab();
    fireEvent.click(row(/^Directly/, /^Card,/));
    expect(param("pin")).toBe("up:Card");
    expect(row(/^Directly/, /^Card,/)).toHaveAttribute("aria-pressed", "true");
    expect(rowsOf(/^Top level · 2 of 15$/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show all 15 top-level components" }));
    expect(param("pin")).toBeNull();
    expect(rowsOf(/^Top level · 15$/)).toHaveLength(15);
  });

  it("runs the route through a component picked in Find", () => {
    renderTab();
    const find = screen.getByRole("combobox");
    fireEvent.change(find, { target: { value: "Shell" } });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /^Shell/ }));
    expect(param("pin")).toBe("up:Shell");
    expect(within(screen.getByRole("list", { name: "Route" })).getByText("Shell")).toBeInTheDocument();
    expect(rowsOf(/^Top level · 1 of 15$/)).toHaveLength(1);
  });

  it("draws a route on the renders side for a component picked in Find", () => {
    renderTab();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Leaf" } });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /^Leaf/ }));
    expect(param("pin")).toBe("down:Leaf");
    expect(within(screen.getByRole("list", { name: "Route" })).getByRole("link", { name: "Open Leaf" })).toBeInTheDocument();
  });

  it.each([
    ["a direct renderer", "pin=up:Card", /^Directly/, /^Card,/],
    ["a top-level component", "pin=up:Solo", /^Top level/, /^Solo,/],
    ["a top-level end", "top=P1", /^Top level/, /^Page, b/],
  ])("restores %s from the link", (_, query, listName, name) => {
    window.history.replaceState(null, "", `http://localhost:3000/x?${query}`);
    renderTab();
    expect(row(listName, name)).toHaveAttribute("aria-pressed", "true");
  });

  it("scrolls a picked row into view", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderTab();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Page" } });
    fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option", { name: /^Page/ })[0] as HTMLElement);
    expect(param("top")).toBe("P1");
    const picked = row(/^Top level/, /^Page, b/).closest("[data-key]");
    expect(scroll.mock.contexts).toContain(picked);
    scroll.mockRestore();
  });

  it("clears the picks on Escape, but Escape in Find only closes Find", () => {
    window.history.replaceState(null, "", "http://localhost:3000/x?pin=up:Card&top=P0");
    renderTab();
    const find = screen.getByRole("combobox");
    fireEvent.focus(find);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(find, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(param("pin")).toBe("up:Card");
    fireEvent.keyDown(row(/^Directly/, /^Card,/), { key: "Escape" });
    expect(param("pin")).toBeNull();
    expect(param("top")).toBeNull();
  });

  it("tells screen readers each row's origin, and that it's deprecated", () => {
    renderTab();
    expect(row(/^Directly/, /^d1, deprecated, External, 11 uses$/)).toBeInTheDocument();
    expect(row(/^Directly/, /^d0, Local, 12 uses$/)).toBeInTheDocument();
    expect(row(/^Top level/, /^Page, a, Local, 3 steps$/)).toBeInTheDocument();
  });

  it("keeps each list to one tab stop and moves through it with the arrow keys", async () => {
    renderTab();
    const top = list(/^Top level/);
    const stops = () => [...top.querySelectorAll<HTMLElement>("button, a")].filter((el) => el.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    const first = stops()[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const second = within(top).getAllByRole("button")[1] as HTMLElement;
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(within(second.closest("li") as HTMLElement).getByRole("link")).toHaveFocus();
    await waitFor(() => expect(stops()).toEqual([document.activeElement]));
  });

  it("shows a long name whole", () => {
    const long = "OnboardingMigrateMembersBrowserViewWithAVeryLongNameIndeed";
    renderTab(graph([node("F"), node(long)], [[long, "F"]]));
    expect(rowsOf(/^Directly/)[0]?.textContent).toContain(long);
    expect(document.body.textContent).not.toContain("…");
  });

  it("says so when nothing renders it and it renders nothing", () => {
    renderTab(graph([node("F")], []));
    expect(screen.getByText("Nothing in this repo renders F, and F renders no other components.")).toBeInTheDocument();
  });

  describe("below 1024px", () => {
    beforeEach(() => {
      const real = window.matchMedia;
      vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ ...real(q), matches: q === "(max-width: 1023px)" }));
    });
    afterEach(() => vi.restoreAllMocks());

    it("opens a top-level row's route under it, each step with its page", () => {
      renderTab();
      const page = row(/^Top level/, /^Page, a/);
      expect(page).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(page);
      expect(param("top")).toBe("P0");
      expect(page).toHaveAttribute("aria-expanded", "true");
      const route = screen.getByRole("list", { name: "Route from Page" });
      expect(within(route).getByRole("link", { name: "Open Shell" })).toBeInTheDocument();
      expect(within(route).getByText("Card")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Route" })).toBeNull();
      expect(document.querySelector("svg[data-connectors]")).toBeNull();
    });

    it("moves past an open route with the arrow keys", () => {
      renderTab();
      fireEvent.click(row(/^Top level/, /^Page, b/));
      const card = within(screen.getByRole("list", { name: "Route from Page" })).getByRole("link", { name: "Open Card" });
      card.focus();
      fireEvent.keyDown(card, { key: "ArrowDown" });
      expect(row(/^Top level/, /^Page, a/)).toHaveFocus();
    });

    it("shows one side at a time", () => {
      renderTab();
      expect(screen.queryByRole("list", { name: /^Renders/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Renders · 2" }));
      expect(rowsOf(/^Directly · 1$/)).toHaveLength(1);
      expect(screen.queryByRole("list", { name: /^Top level/ })).toBeNull();
    });
  });
});
