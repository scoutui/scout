"use server";
import { signOut } from "@/auth";
import { can } from "@/lib/access";
import { findByUserCode, markApproved, markDenied } from "@/lib/cli-device-codes";
import { identify } from "@/lib/identity";

type DeviceActionResult = { ok: boolean; error?: string };

async function validatePendingCode(userCode: string): Promise<DeviceActionResult> {
  const row = await findByUserCode(userCode);
  if (!row || row.status !== "pending") return { ok: false, error: "invalid_code" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, error: "expired" };
  return { ok: true };
}

export async function approveDevice(userCode: string): Promise<DeviceActionResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person" || !can(identity, "view")) return { ok: false, error: "not_authenticated" };
  const validation = await validatePendingCode(userCode);
  if (!validation.ok) return validation;
  return (await markApproved(userCode, identity.userId))
    ? { ok: true }
    : { ok: false, error: "invalid_code" };
}

export async function denyDevice(userCode: string): Promise<DeviceActionResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person" || !can(identity, "view")) return { ok: false, error: "not_authenticated" };
  const validation = await validatePendingCode(userCode);
  if (!validation.ok) return validation;
  return (await markDenied(userCode)) ? { ok: true } : { ok: false, error: "invalid_code" };
}

export async function switchDeviceAccount(userCode: string): Promise<DeviceActionResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person" || !can(identity, "view")) return { ok: false, error: "not_authenticated" };
  const validation = await validatePendingCode(userCode);
  if (!validation.ok) return validation;

  const devicePath = `/login/device?code=${encodeURIComponent(userCode)}&switch=1`;
  const loginPath = `/login?callbackUrl=${encodeURIComponent(devicePath)}`;
  await signOut({ redirectTo: loginPath });
  return { ok: true };
}
