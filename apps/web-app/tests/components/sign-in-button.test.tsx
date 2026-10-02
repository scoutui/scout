// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

import { signIn } from "next-auth/react";
import { SignInButton } from "@/components/auth/sign-in-button";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("SignInButton", () => {
  it("uses the normal OIDC flow for an ordinary callback", () => {
    render(<SignInButton callbackUrl="/repos" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", { callbackUrl: "/repos" });
  });

  it("asks the provider to select an account for a device switch", () => {
    render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH&switch=1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith(
      "oidc",
      { callbackUrl: "/login/device?code=ABCD-EFGH&switch=1" },
      { prompt: "select_account" },
    );
  });

  it("keeps initial device sign-in and its explicit error retry on the normal OIDC call", () => {
    render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH" signInError />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", {
      callbackUrl: "/login/device?code=ABCD-EFGH",
    });
  });

  it("offers an explicit login prompt after a switch attempt returns with an OIDC error", () => {
    render(<SignInButton callbackUrl="/login/device?code=ABCD-EFGH&switch=1" signInError />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith(
      "oidc",
      { callbackUrl: "/login/device?code=ABCD-EFGH&switch=1" },
      { prompt: "login" },
    );
  });

  it("does not enter switch mode from an unrelated callback with the same query marker", () => {
    render(<SignInButton callbackUrl="/repos?switch=1" signInError />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(signIn).toHaveBeenCalledExactlyOnceWith("oidc", { callbackUrl: "/repos?switch=1" });
  });
});
