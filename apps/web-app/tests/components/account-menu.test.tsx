// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Person } from "@/lib/access";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/repos" }));

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
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ callbackUrl: "/login" });
  });

  it("closes the menu when Settings is clicked", async () => {
    render(<AccountMenu person={admin} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
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
  it("shows the governance tab only when showGovernance is set", () => {
    const { rerender } = render(<TopTabs showGovernance={false} />);
    expect(screen.getByRole("link", { name: "charts" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "governance" })).toBeNull();
    rerender(<TopTabs showGovernance />);
    expect(screen.getByRole("link", { name: "governance" })).toHaveAttribute("href", "/governance");
  });
});
