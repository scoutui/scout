import { NextResponse } from "next/server";
import { deleteDeniedDeviceCode, findByDeviceCodeHash, pruneDeviceCodes, touchPoll } from "@/lib/cli-device-codes";
import { consumeApprovedDeviceCode } from "@/lib/cli-session-store";
import { hashToken } from "@/lib/cli-session-tokens";
import { identify } from "@/lib/identity";
import { rateLimit, clientKey, logRateLimitRejection } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";

const INTERVAL_MS = 5_000;
const BODY_LIMIT_BYTES = 4096;

// A legitimate login polls every 5s for up to the 600s code TTL (about 120
// calls), so the ceiling has to clear that with room.
const POLL_LIMIT = 2400;
const POLL_WINDOW_MS = 600_000;

export async function POST(req: Request): Promise<Response> {
  // Same code and status as the per-record interval check below: RFC 8628 §3.5
  // slow_down, HTTP 400 per RFC 6749 §5.2. The CLI adds 5s to its interval on
  // receipt (packages/cli/src/commands/auth.ts), so a login that trips the
  // ceiling degrades into a slower poll rather than failing.
  const key = `cli-token:${clientKey(req)}`;
  if (!rateLimit(key, POLL_LIMIT, POLL_WINDOW_MS).ok) {
    logRateLimitRejection("cli-token", key);
    return NextResponse.json({ error: "slow_down" }, { status: 400 });
  }

  const read = await readJsonBody(req, BODY_LIMIT_BYTES);
  if ("tooLarge" in read) return read.tooLarge;
  const { body } = read;

  const b = body as { device_code?: unknown };
  if (!body || typeof body !== "object" || typeof b.device_code !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const rawDeviceCode = b.device_code;
  try {
    return await pollDeviceCode(rawDeviceCode);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

async function pollDeviceCode(rawDeviceCode: string): Promise<Response> {
  const hash = hashToken(rawDeviceCode);
  await pruneDeviceCodes();
  const record = await findByDeviceCodeHash(hash);

  // Unknown or expired.
  if (!record) {
    return NextResponse.json({ error: "expired_token" }, { status: 400 });
  }

  if (record.expiresAt < new Date()) {
    return NextResponse.json({ error: "expired_token" }, { status: 400 });
  }

  const { id, status, approvedUserId, lastPolledAt } = record;

  // consumed = already exchanged once
  if (status === "consumed") {
    return NextResponse.json({ error: "expired_token" }, { status: 400 });
  }

  if (status === "denied") {
    await deleteDeniedDeviceCode(id);
    return NextResponse.json({ error: "access_denied" }, { status: 400 });
  }

  if (status === "pending") {
    // Enforce polling interval (slow_down) only while waiting for approval (RFC 8628 §3.5).
    if (lastPolledAt && Date.now() - lastPolledAt.getTime() < INTERVAL_MS) {
      return NextResponse.json({ error: "slow_down" }, { status: 400 });
    }
    await touchPoll(id);
    return NextResponse.json({ error: "authorization_pending" }, { status: 400 });
  }

  if (status === "approved") {
    if (!approvedUserId) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    const session = await consumeApprovedDeviceCode(id, approvedUserId);
    if (!session) return NextResponse.json({ error: "expired_token" }, { status: 400 });
    const identity = await identify({ bearer: `Bearer ${session.token}` }).catch(() => null);

    return NextResponse.json({
      access_token: session.token,
      token_type: "Bearer",
      email: session.email,
      role: identity?.kind === "person" ? identity.role : null,
    });
  }

  return NextResponse.json({ error: "server_error" }, { status: 500 });
}
