// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Person } from "@/lib/access";

const nav = vi.hoisted(() => ({ pathname: "/repos" }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { signOut } from "next-auth/react";
import { AccountMenu } from "@/components/auth/account-menu";
import { TopTabs } from "@/components/nav/top-tabs";
import { ThemeProvider } from "@/components/theme/theme-provider";

const admin: Person = { kind: "person", userId: "ana", email: "ana@example.com", name: "Ana Ruiz", role: "admin", roleSource: "people" };

const renderAccount = (person: Person) =>
  render(
    <ThemeProvider>
      <AccountMenu person={person} />
    </ThemeProvider>,
  );

describe("AccountMenu", () => {
  beforeEach(() => {
    nav.pathname = "/repos";
    window.localStorage.clear();
  });

  it("shows an Admin their name, email and role, a Settings link, and signs them out", async () => {
    renderAccount(admin);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ callbackUrl: "/login" });
  });

  it("shows the role under the email, with the name, not as a group of its own", async () => {
    renderAccount(admin);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const role = await screen.findByText("Admin");
    expect(role.parentElement).toHaveTextContent("Ana Ruizana@example.comAdmin");
    expect(screen.queryByRole("group", { name: "Admin" })).toBeNull();
  });

  it("closes the menu when Settings is clicked", async () => {
    renderAccount(admin);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const settings = await screen.findByRole("menuitem", { name: "Settings" });
    document.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it.each([
    { pathname: "/settings", current: "page" },
    { pathname: "/repos", current: null },
  ])("marks Settings as the current page on $pathname: $current", async ({ pathname, current }) => {
    nav.pathname = pathname;
    renderAccount(admin);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect((await screen.findByRole("menuitem", { name: "Settings" })).getAttribute("aria-current")).toBe(current);
  });

  it("offers an Editor no Settings link", async () => {
    renderAccount({ ...admin, role: "editor" });
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("Editor")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull();
  });

  it("ticks only the theme you picked, and picks another", async () => {
    renderAccount(admin);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const themes = await screen.findAllByRole("menuitemradio");
    expect(themes.map(t => [t.textContent, t.getAttribute("aria-checked")])).toEqual([
      ["System", "true"],
      ["Light", "false"],
      ["Dark", "false"],
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "false");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it.each([
    { name: "Ana Ruiz", email: "ana@example.com", initials: "AR" },
    { name: null, email: "sam@example.com", initials: "S" },
  ])("shows $initials on the button for $email", ({ name, email, initials }) => {
    renderAccount({ ...admin, name, email });
    expect(screen.getByRole("button", { name: "Account" }).textContent).toBe(initials);
  });
});

const APP_DIR = join(__dirname, "../../src/app");

const PLACES = [
  { route: "/charts", tab: "charts" },
  { route: "/charts/[dashboardId]", tab: "charts" },
  { route: "/charts/[dashboardId]/edit", tab: "charts" },
  { route: "/charts/new", tab: "charts" },
  { route: "/components/[componentId]", tab: "packages" },
  { route: "/governance", tab: "governance" },
  { route: "/login/device", tab: null },
  { route: "/packages", tab: "packages" },
  { route: "/packages/[packageName]", tab: "packages" },
  { route: "/repos", tab: "repos" },
  { route: "/repos/[repoId]", tab: "repos" },
  { route: "/repos/[repoId]/components/[componentId]", tab: "repos" },
  { route: "/repos/[repoId]/scans", tab: "repos" },
  { route: "/settings", tab: null },
];

const menuButton = () => screen.getByRole("button", { name: "Menu" });
const panelOf = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
const currentLinks = (container: HTMLElement) =>
  within(container)
    .queryAllByRole("link")
    .filter(link => link.getAttribute("aria-current") === "page")
    .map(link => link.textContent);

describe("TopTabs", () => {
  beforeEach(() => {
    nav.pathname = "/repos";
  });

  it("shows the governance tab only when showGovernance is set", () => {
    const { rerender } = render(<TopTabs showGovernance={false} />);
    expect(screen.getByRole("link", { name: "charts" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "governance" })).toBeNull();
    rerender(<TopTabs showGovernance />);
    expect(screen.getByRole("link", { name: "governance" })).toHaveAttribute("href", "/governance");
  });

  it("has a place for every page that shows the header", () => {
    const routes = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
      .filter(file => basename(file) === "page.tsx")
      .map(file => `/${dirname(file)}`)
      .filter(route => route !== "/login");
    expect(PLACES.map(place => place.route).sort()).toEqual(routes.sort());
  });

  it.each([...PLACES, { route: "/no-such-page", tab: null }].map(place => ({ ...place, marked: place.tab ?? "no page" })))("marks $marked as the current page on $route", ({ route, tab }) => {
    nav.pathname = route.replace(/\[\w+\]/g, "example");
    const { container } = render(<TopTabs showGovernance />);
    expect(currentLinks(container)).toEqual(tab ? [tab] : []);
    fireEvent.click(menuButton());
    expect(currentLinks(panelOf(menuButton()))).toEqual(tab ? [tab] : []);
  });

  it("opens the pages from a Menu button, as a list of links under the header, and closes them again", () => {
    render(<TopTabs showGovernance />);
    const button = menuButton();
    const panel = panelOf(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-haspopup");
    expect(panel).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(panel.tagName).toBe("NAV");
    expect(panel).toHaveAccessibleName("Pages");
    expect(within(panel).getByRole("list")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toEqual([]);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
  });

  it.each([
    { role: "a Viewer", showGovernance: false, pages: ["repos", "packages", "charts"] },
    { role: "an Admin", showGovernance: true, pages: ["repos", "packages", "charts", "governance"] },
  ])("lists every page $role can see, marking the current one", ({ showGovernance, pages }) => {
    nav.pathname = "/packages";
    render(<TopTabs showGovernance={showGovernance} />);
    fireEvent.click(menuButton());
    const links = within(panelOf(menuButton())).getAllByRole("link");
    expect(links.map(link => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual(
      pages.map(page => [page, `/${page}`, page === "packages" ? "page" : null]),
    );
  });

  it("puts the links right after the Menu button in the tab order, before the logo", () => {
    const { container } = render(<TopTabs showGovernance />);
    fireEvent.click(menuButton());
    const order = [...container.querySelectorAll<HTMLElement>("a[href], button")]
      .filter(element => element.tabIndex >= 0 && !element.closest("[hidden]"))
      .map(element => element.getAttribute("aria-label") ?? element.textContent);
    expect(order.slice(0, 6)).toEqual(["Menu", "repos", "packages", "charts", "governance", "Scout"]);
  });

  it.each([
    { from: "a link", target: () => within(panelOf(menuButton())).getByRole("link", { name: "charts" }) },
    { from: "the Menu button", target: menuButton },
  ])("closes with Escape from $from and puts focus back on the Menu button", ({ target }) => {
    render(<TopTabs showGovernance />);
    fireEvent.click(menuButton());
    const element = target();
    element.focus();
    fireEvent.keyDown(element, { key: "Escape" });
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });

  it("closes when a link is chosen", () => {
    render(<TopTabs showGovernance />);
    fireEvent.click(menuButton());
    const link = within(panelOf(menuButton())).getByRole("link", { name: "charts" });
    document.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    { how: "focus moves past the last link", act: () => fireEvent.blur(within(panelOf(menuButton())).getByRole("link", { name: "governance" }), { relatedTarget: screen.getByRole("link", { name: "Scout" }) }) },
    { how: "the page is tapped outside it", act: () => fireEvent.pointerDown(document.body) },
  ])("closes when $how", ({ act }) => {
    render(<TopTabs showGovernance />);
    fireEvent.click(menuButton());
    act();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open while focus moves between its links", () => {
    render(<TopTabs showGovernance />);
    fireEvent.click(menuButton());
    const panel = panelOf(menuButton());
    fireEvent.blur(within(panel).getByRole("link", { name: "repos" }), { relatedTarget: within(panel).getByRole("link", { name: "packages" }) });
    fireEvent.pointerDown(within(panel).getByRole("link", { name: "packages" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
  });
});
