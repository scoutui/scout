import { beforeEach, describe, expect, it, vi } from "vitest";

const session = { value: null as null | { user: { id: string; email: string } } };
const dc = { row: null as null | { status: string; expiresAt: Date } };
const approval = { accepted: true };
const denial = { accepted: true };

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => session.value),
  signOut: vi.fn(async () => {}),
}));
vi.mock("@/lib/cli-device-codes", () => ({
  findByUserCode: vi.fn(async () => dc.row),
  markApproved: vi.fn(async () => approval.accepted),
  markDenied: vi.fn(async () => denial.accepted),
}));

import { signOut } from "@/auth";
import { approveDevice, denyDevice, switchDeviceAccount } from "@/app/login/device/actions";
import { markApproved, markDenied } from "@/lib/cli-device-codes";

beforeEach(() => {
  vi.clearAllMocks();
  session.value = { user: { id: "u1", email: "alice@example.com" } };
  dc.row = { status: "pending", expiresAt: new Date(Date.now() + 60_000) };
  approval.accepted = true;
  denial.accepted = true;
});

describe("approveDevice", () => {
  it("approves a pending, unexpired code for the signed-in user", async () => {
    expect(await approveDevice("ABCD-EFGH")).toEqual({ ok: true });
    expect(markApproved).toHaveBeenCalledWith("ABCD-EFGH", "u1");
  });

  it("rejects an unauthenticated request", async () => {
    session.value = null;
    expect(await approveDevice("ABCD-EFGH")).toEqual({ ok: false, error: "not_authenticated" });
    expect(markApproved).not.toHaveBeenCalled();
  });

  it("rejects a code that is missing, not pending, or expired", async () => {
    for (const row of [null, { status: "approved", expiresAt: new Date(Date.now() + 60_000) }, { status: "pending", expiresAt: new Date(0) }]) {
      dc.row = row;
      expect((await approveDevice("ABCD-EFGH")).ok).toBe(false);
    }
    expect(markApproved).not.toHaveBeenCalled();
  });

  it("reports a lost approval race without claiming success", async () => {
    approval.accepted = false;
    expect(await approveDevice("ABCD-EFGH")).toEqual({ ok: false, error: "invalid_code" });
  });
});

describe("denyDevice", () => {
  it("denies a pending, unexpired code", async () => {
    expect(await denyDevice("ABCD-EFGH")).toEqual({ ok: true });
    expect(markDenied).toHaveBeenCalledExactlyOnceWith("ABCD-EFGH");
    expect(markApproved).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    session.value = null;
    expect(await denyDevice("ABCD-EFGH")).toEqual({ ok: false, error: "not_authenticated" });
    expect(markDenied).not.toHaveBeenCalled();
  });

  it("does not deny missing, non-pending, or expired codes", async () => {
    for (const row of [null, { status: "approved", expiresAt: new Date(Date.now() + 60_000) }, { status: "pending", expiresAt: new Date(0) }]) {
      dc.row = row;
      expect((await denyDevice("ABCD-EFGH")).ok).toBe(false);
    }
    expect(markDenied).not.toHaveBeenCalled();
  });

  it("reports a lost denial race without claiming success", async () => {
    denial.accepted = false;
    expect(await denyDevice("ABCD-EFGH")).toEqual({ ok: false, error: "invalid_code" });
  });
});

describe("switchDeviceAccount", () => {
  it("ends only the browser session and preserves the pending code in a local callback", async () => {
    await switchDeviceAccount("ABCD-EFGH");
    expect(signOut).toHaveBeenCalledExactlyOnceWith({
      redirectTo: "/login?callbackUrl=%2Flogin%2Fdevice%3Fcode%3DABCD-EFGH%26switch%3D1",
    });
    expect(markApproved).not.toHaveBeenCalled();
    expect(markDenied).not.toHaveBeenCalled();
  });

  it("does not sign out without an authenticated user", async () => {
    session.value = null;
    expect(await switchDeviceAccount("ABCD-EFGH")).toEqual({ ok: false, error: "not_authenticated" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not sign out for missing, non-pending, or expired codes", async () => {
    for (const row of [null, { status: "denied", expiresAt: new Date(Date.now() + 60_000) }, { status: "pending", expiresAt: new Date(0) }]) {
      dc.row = row;
      expect((await switchDeviceAccount("ABCD-EFGH")).ok).toBe(false);
    }
    expect(signOut).not.toHaveBeenCalled();
  });
});
