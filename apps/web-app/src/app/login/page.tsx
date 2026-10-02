import { CircleX } from "lucide-react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { DevSignInForm } from "@/components/auth/dev-sign-in-form";
import { BrandMark } from "@/components/ui/brand-mark";
import { isDevAuthEnabled, isOidcConfigured } from "@/lib/auth-providers";
import { safeCallbackUrl } from "@/lib/callback-url";
import { ACCESS_CHECK_UNAVAILABLE } from "@/lib/sign-in-errors";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl: rawCallbackUrl } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallbackUrl);

  // Mirrors the Auth.js provider list (src/lib/auth-providers.ts). Outside
  // development the dev form never renders, even if DEV_AUTH_PASSWORD is set.
  // The SSO button is hidden when OIDC isn't configured, which only happens in
  // local dev running on the dev sign-in alone.
  const devEnabled = isDevAuthEnabled();
  const oidcEnabled = isOidcConfigured();

  return (
    <div className="flex min-h-[calc(100vh-2.75rem)] items-center justify-center px-6 py-12">
      <div className="panel w-full max-w-xs p-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-10 rounded-lg" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">Scout</h1>
            <p className="text-sm text-muted-foreground">
              Design-system component usage across your repos.
            </p>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-center justify-center gap-2 text-sm text-foreground"
          >
            <CircleX aria-hidden className="size-4 text-status-err" />
            <span>
              {error === "AccessDenied"
                ? "Your account doesn't have access to this dashboard. Ask your dashboard administrator to add you."
                : error === ACCESS_CHECK_UNAVAILABLE
                  ? "We couldn't check your access just now. Try again in a few minutes."
                  : "Sign-in didn't complete. Try again."}
            </span>
          </div>
        ) : null}

        {oidcEnabled ? (
          <div className="mt-6">
            <SignInButton
              callbackUrl={callbackUrl}
              signInError={Boolean(error)}
              recoverDeviceCallback={Boolean(error) && !rawCallbackUrl}
            />
          </div>
        ) : null}

        {devEnabled ? (
          <div className="mt-6 flex flex-col gap-3">
            {oidcEnabled ? (
              <div
                aria-hidden
                className="flex items-center gap-3 text-label text-muted-foreground/50"
              >
                <div className="h-px flex-1 bg-border" />
                <span>dev</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <DevSignInForm callbackUrl={callbackUrl} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
