// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const browserSession = { value: { user: { id: "u1", email: "alice@example.com" } } };
vi.mock("@/auth", () => ({ auth: vi.fn(async () => browserSession.value) }));
vi.mock("@/app/login/device/actions", () => ({
  approveDevice: vi.fn(),
  denyDevice: vi.fn(),
  switchDeviceAccount: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

import DevicePage from "@/app/login/device/page";
import { SignInButton } from "@/components/auth/sign-in-button";

async function renderDevicePage(params: { code?: string; approved?: string; denied?: string; error?: string; switch?: string } = {}) {
  return render(await DevicePage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  browserSession.value = { user: { id: "u1", email: "alice@example.com" } };
  sessionStorage.clear();
});

describe("DevicePage", () => {
  it("shows the current browser identity and three explicit choices for a pending code", async () => {
    await renderDevicePage({ code: "ABCD-EFGH" });

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another account" })).toBeInTheDocument();
    expect(screen.getAllByRole("form")).toHaveLength(3);
  });

  it("still requires approval after returning from an account switch", async () => {
    browserSession.value = { user: { id: "u2", email: "bob@example.com" } };
    await renderDevicePage({ code: "ABCD-EFGH", switch: "1" });
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
  });

  it("shows completion and no approval form after approval or denial", async () => {
    const view = await renderDevicePage({ code: "ABCD-EFGH", approved: "1" });
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();

    view.unmount();
    await renderDevicePage({ code: "ABCD-EFGH", denied: "1" });
    expect(screen.getByText(/Denied/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("gives an expired code a clear recovery message", async () => {
    await renderDevicePage({ code: "ABCD-EFGH", error: "expired" });
    expect(screen.getByRole("alert")).toHaveTextContent(/Run scout auth login again/);
  });

  it("clears the saved switch hint after returning to device approval", async () => {
    const first = render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH&switch=1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(sessionStorage.length).toBe(1);
    first.unmount();

    await renderDevicePage({ code: "ABCD-EFGH", switch: "1" });
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
