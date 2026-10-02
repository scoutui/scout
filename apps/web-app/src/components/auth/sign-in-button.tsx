"use client";
import { useEffect } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { safeDeviceCallback } from "@/lib/callback-url";

const DEVICE_CALLBACK_KEY = "scout:device-callback";

function saveDeviceCallback(callbackUrl: string | null): void {
  try {
    if (callbackUrl) {
      sessionStorage.setItem(DEVICE_CALLBACK_KEY, callbackUrl);
    } else {
      sessionStorage.removeItem(DEVICE_CALLBACK_KEY);
    }
  } catch {
    // Storage can be unavailable in restrictive browser modes; sign-in still works.
  }
}

function takeDeviceCallback(): string | null {
  try {
    const stored = sessionStorage.getItem(DEVICE_CALLBACK_KEY);
    sessionStorage.removeItem(DEVICE_CALLBACK_KEY);
    return safeDeviceCallback(stored ?? undefined);
  } catch {
    return null;
  }
}

export function ClearDeviceSignInAttempt() {
  useEffect(() => saveDeviceCallback(null), []);
  return null;
}

export function SignInButton({
  callbackUrl,
  signInError = false,
  recoverDeviceCallback = false,
}: {
  callbackUrl: string;
  signInError?: boolean;
  recoverDeviceCallback?: boolean;
}) {
  function startSignIn() {
    const deviceCallback =
      safeDeviceCallback(callbackUrl) ??
      (signInError && recoverDeviceCallback ? takeDeviceCallback() : null);
    if (deviceCallback) {
      saveDeviceCallback(deviceCallback);
      if (new URL(deviceCallback, "http://internal.invalid").searchParams.get("switch") === "1") {
        return signIn("oidc", { callbackUrl: deviceCallback }, { prompt: signInError ? "login" : "select_account" });
      }
      return signIn("oidc", { callbackUrl: deviceCallback });
    }
    saveDeviceCallback(null);
    return signIn("oidc", { callbackUrl });
  }

  return (
    <Button className="w-full" onClick={startSignIn}>
      Sign in with SSO
    </Button>
  );
}
