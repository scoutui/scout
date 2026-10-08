// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it.each([
    { pathname: "/packages", label: "packages" },
    { pathname: "/charts/trend", label: "charts" },
    { pathname: "/components/a0c37f735b019024", label: "menu" },
  ])("names the page menu $label on $pathname", ({ pathname, label }) => {
    nav.pathname = pathname;
    render(<TopTabs showGovernance />);
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-haspopup", "menu");
  });

  it.each([
    { role: "a Viewer", showGovernance: false, pages: ["repos", "packages", "charts"] },
    { role: "an Admin", showGovernance: true, pages: ["repos", "packages", "charts", "governance"] },
  ])("lists every page $role can see in the page menu, marking the current one", async ({ showGovernance, pages }) => {
    nav.pathname = "/packages";
    render(<TopTabs showGovernance={showGovernance} />);
    fireEvent.click(screen.getByRole("button", { name: "packages" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map(item => [item.textContent, item.getAttribute("href"), item.getAttribute("aria-current")])).toEqual(
      pages.map(page => [page, `/${page}`, page === "packages" ? "page" : null]),
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
