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

const admin: Person = { kind: "person", userId: "ana", email: "ana@example.com", name: "Ana Ruiz", role: "admin", roleSource: "people" };

describe("AccountMenu", () => {
  it("shows an Admin their name, email and role, a Settings link, and signs them out", async () => {
    render(<AccountMenu person={admin} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Admin" })).getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ callbackUrl: "/login" });
  });

  it("closes the menu when Settings is clicked", async () => {
    render(<AccountMenu person={admin} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const settings = await screen.findByRole("menuitem", { name: "Settings" });
    document.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("offers an Editor no Settings link", async () => {
    render(<AccountMenu person={{ ...admin, role: "editor" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("Editor")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull();
  });

  it.each([
    { name: "Ana Ruiz", email: "ana@example.com", initials: "AR" },
    { name: null, email: "sam@example.com", initials: "S" },
  ])("shows $initials on the button for $email", ({ name, email, initials }) => {
    render(<AccountMenu person={{ ...admin, name, email }} />);
    expect(screen.getByRole("button", { name: "Account" }).textContent).toBe(initials);
  });
});

const APP_DIR = join(__dirname, "../../src/app");

const PLACES = [
  { route: "/charts", label: "charts", underlined: true },
  { route: "/charts/[dashboardId]", label: "charts", underlined: true },
  { route: "/charts/[dashboardId]/edit", label: "charts", underlined: true },
  { route: "/charts/new", label: "charts", underlined: true },
  { route: "/components/[componentId]", label: "packages", underlined: true },
  { route: "/governance", label: "governance", underlined: true },
  { route: "/login/device", label: "Pages", shown: "", underlined: false },
  { route: "/packages", label: "packages", underlined: true },
  { route: "/packages/[packageName]", label: "packages", underlined: true },
  { route: "/repos", label: "repos", underlined: true },
  { route: "/repos/[repoId]", label: "repos", underlined: true },
  { route: "/repos/[repoId]/components/[componentId]", label: "repos", underlined: true },
  { route: "/repos/[repoId]/scans", label: "repos", underlined: true },
  { route: "/settings", label: "settings", underlined: false },
];

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

  it.each([...PLACES, { route: "/no-such-page", label: "Pages", shown: "", underlined: false }])(
    "names the page menu $label on $route",
    ({ route, label, shown, underlined }) => {
      nav.pathname = route.replace(/\[\w+\]/g, "example");
      render(<TopTabs showGovernance />);
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-haspopup", "menu");
      expect(button.textContent).toBe(shown ?? label);
      const current = screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page");
      expect(current.map(link => link.textContent)).toEqual(underlined ? [label] : []);
    },
  );

  it.each([
    { role: "a Viewer", showGovernance: false, pathname: "/packages", button: "packages", current: "packages", pages: ["repos", "packages", "charts"] },
    { role: "an Admin", showGovernance: true, pathname: "/packages", button: "packages", current: "packages", pages: ["repos", "packages", "charts", "governance"] },
    { role: "an Admin", showGovernance: true, pathname: "/settings", button: "settings", current: "none", pages: ["repos", "packages", "charts", "governance"] },
    { role: "an Admin", showGovernance: true, pathname: "/no-such-page", button: "Pages", current: "none", pages: ["repos", "packages", "charts", "governance"] },
  ])("lists every page $role can see in the page menu on $pathname, ticking $current", async ({ showGovernance, pathname, button, current, pages }) => {
    nav.pathname = pathname;
    render(<TopTabs showGovernance={showGovernance} />);
    fireEvent.click(screen.getByRole("button", { name: button }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map(item => [item.textContent, item.getAttribute("href"), item.getAttribute("aria-current")])).toEqual(
      pages.map(page => [page, `/${page}`, page === current ? "page" : null]),
    );
  });

  it("moves through the page menu with the arrow keys and closes it with Escape", async () => {
    nav.pathname = "/packages";
    render(<TopTabs showGovernance />);
    const button = screen.getByRole("button", { name: "packages" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "repos" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "packages" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(button).toHaveFocus();
  });
});
