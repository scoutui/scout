import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ClearDeviceSignInAttempt } from "@/components/auth/sign-in-button";
import { approveDevice, denyDevice, switchDeviceAccount } from "./actions";
import { DeviceSubmitButton } from "./submit-button";

export const metadata = { title: "Approve device" };

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; approved?: string; denied?: string; error?: string; switch?: string }>;
}) {
  const { code, approved, denied, error } = await searchParams;
  const session = await auth();

  if (!code) {
    return (
      <div className="mx-auto flex min-h-[calc(100svh-2.75rem)] max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="font-wordmark text-2xl font-semibold">Scout</div>
        <p className="text-sm text-muted-foreground">
          This page approves a CLI sign-in and needs a device code. Run{" "}
          <code className="font-mono text-foreground">scout auth login</code> in your
          terminal to start one.
        </p>
        <Link
          href="/repos"
          className="text-sm text-foreground underline-offset-4 hover:underline"
        >
          Open Scout
        </Link>
      </div>
    );
  }

  async function handleApprove(formData: FormData) {
    "use server";
    const userCode = formData.get("code");
    if (typeof userCode !== "string") return;
    const result = await approveDevice(userCode);
    if (result.ok) {
      redirect(`/login/device?code=${encodeURIComponent(userCode)}&approved=1`);
    } else {
      redirect(`/login/device?code=${encodeURIComponent(userCode)}&error=${encodeURIComponent(result.error ?? "unknown")}`);
    }
  }

  async function handleDeny(formData: FormData) {
    "use server";
    const userCode = formData.get("code");
    if (typeof userCode !== "string") return;
    const result = await denyDevice(userCode);
    if (result.ok) {
      redirect(`/login/device?code=${encodeURIComponent(userCode)}&denied=1`);
    } else {
      redirect(`/login/device?code=${encodeURIComponent(userCode)}&error=${encodeURIComponent(result.error ?? "unknown")}`);
    }
  }

  async function handleSwitch(formData: FormData) {
    "use server";
    const userCode = formData.get("code");
    if (typeof userCode !== "string") return;
    const result = await switchDeviceAccount(userCode);
    if (!result.ok) {
      redirect(`/login/device?code=${encodeURIComponent(userCode)}&error=${encodeURIComponent(result.error ?? "unknown")}`);
    }
  }

  if (approved === "1" || denied === "1") {
    return (
      <div className="mx-auto flex min-h-[calc(100svh-2.75rem)] max-w-sm flex-col items-center justify-center gap-10 px-6">
        <div className="font-wordmark text-2xl font-semibold">Scout</div>
        <div className="flex w-full flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground">
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">
              Device code
            </span>
            <span className="font-mono text-lg font-semibold tracking-widest">{code}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {approved === "1"
              ? "Approved. You can return to your terminal."
              : "Denied. You can return to your terminal."}
          </p>
        </div>
      </div>
    );
  }

  function errorMessage(errorCode: string | undefined): string {
    switch (errorCode) {
      case "expired":
        return "This code has expired. Run scout auth login again to get a new one.";
      case "invalid_code":
        return "That code is no longer valid. Run scout auth login again to get a new one.";
      case "not_authenticated":
        return "Your session has expired. Sign in again.";
      default:
        return "Approval failed. Run scout auth login again to get a new code.";
    }
  }

  const codeUnavailable = error === "expired" || error === "invalid_code";

  return (
    <div className="mx-auto flex min-h-[calc(100svh-2.75rem)] max-w-sm flex-col items-center justify-center gap-10 px-6">
      <ClearDeviceSignInAttempt />
      <div className="font-wordmark text-2xl font-semibold">Scout</div>
      <div className="flex w-full flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground">
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-muted-foreground">
            Signed in as
          </span>
          <span className="min-w-0 break-words text-sm">{session?.user?.email}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-muted-foreground">
            Device code
          </span>
          <span className="break-all font-mono text-lg font-semibold tracking-widest">{code}</span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">{errorMessage(error)}</p>
        )}
        {!codeUnavailable && (
          <div className="flex flex-col gap-2 pt-2">
            <form action={handleApprove} aria-label="Approve CLI sign-in">
              <input type="hidden" name="code" value={code} />
              <DeviceSubmitButton intent="approve" />
            </form>
            <form action={handleDeny} aria-label="Deny CLI sign-in">
              <input type="hidden" name="code" value={code} />
              <DeviceSubmitButton intent="deny" />
            </form>
            <form action={handleSwitch} aria-label="Switch account for CLI sign-in">
              <input type="hidden" name="code" value={code} />
              <DeviceSubmitButton intent="switch" />
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
