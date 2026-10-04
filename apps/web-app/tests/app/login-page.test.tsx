// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth-providers", () => ({
  isDevAuthEnabled: vi.fn(() => false),
  isOidcConfigured: vi.fn(() => true),
}));

import { signIn } from "next-auth/react";
import LoginPage from "@/app/login/page";
import { SignInButton } from "@/components/auth/sign-in-button";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("LoginPage", () => {
  it("explains a denied account and who can grant access, keeping the sign-in button for another account", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ error: "AccessDenied" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account doesn't have access to this dashboard. Ask your dashboard administrator to add you.",
    );
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeEnabled();
  });

  it("asks the user to retry later when their access couldn't be checked", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ error: "AccessCheckUnavailable" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't check your access. Try again in a few minutes.",
    );
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeEnabled();
  });

  it("retries the initial device code after an error-only access denial without forcing an IdP prompt", async () => {
    const first = render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", {
      callbackUrl: "/login/device?code=ABCD-EFGH",
    });
    expect(sessionStorage.length).toBe(1);
    first.unmount();
    vi.clearAllMocks();

    render(await LoginPage({ searchParams: Promise.resolve({ error: "AccessDenied" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", {
      callbackUrl: "/login/device?code=ABCD-EFGH",
    });
    expect(sessionStorage.length).toBe(1);
  });

  it("recovers the device callback when Auth.js returns only an OAuth error", async () => {
    const first = render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH&switch=1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(sessionStorage.length).toBe(1);
    first.unmount();
    vi.clearAllMocks();

    render(await LoginPage({ searchParams: Promise.resolve({ error: "OAuthCallbackError" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in didn't complete. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith(
      "oidc",
      { callbackUrl: "/login/device?code=ABCD-EFGH&switch=1" },
      { prompt: "login" },
    );
  });

  it.each([
    "https://evil.example/login/device?code=ABCD-EFGH&switch=1",
    "//evil.example/login/device?code=ABCD-EFGH&switch=1",
    "/repos?switch=1",
    "/login/device?code=bad&switch=1",
    "/login/device?code=bad",
    "/login/device?code=ABCD-EFGH&next=/repos",
    "/login/device?code=ABCD-EFGH&switch=1&next=/repos",
  ])("ignores an invalid persisted callback: %s", async (stored) => {
    const first = render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH&switch=1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    const key = sessionStorage.key(0);
    expect(key).not.toBeNull();
    sessionStorage.setItem(key ?? "", stored);
    first.unmount();
    vi.clearAllMocks();

    render(await LoginPage({ searchParams: Promise.resolve({ error: "OAuthCallbackError" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", { callbackUrl: "/repos" });
    expect(sessionStorage.length).toBe(0);
  });

  it("does not recover a saved switch hint when the error supplies an unsafe callback", async () => {
    const first = render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH&switch=1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(sessionStorage.length).toBe(1);
    first.unmount();
    vi.clearAllMocks();

    render(await LoginPage({ searchParams: Promise.resolve({
      error: "OAuthCallbackError",
      callbackUrl: "https://evil.example/login/device?code=ABCD-EFGH&switch=1",
    }) }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", { callbackUrl: "/repos" });
    expect(sessionStorage.length).toBe(0);
  });
});
