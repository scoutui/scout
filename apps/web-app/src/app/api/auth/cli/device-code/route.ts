import { NextResponse } from "next/server";
import { builtWithCli } from "@/lib/built-with-cli";
import { createDeviceCode, pruneDeviceCodes } from "@/lib/cli-device-codes";
import { dashboardWarning } from "@/lib/dashboard-warning";
import { rateLimit, clientKey, logRateLimitRejection } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { versionRefusal } from "@/lib/scan-acceptance";

// Unauthenticated write endpoint: every call inserts a cli_device_codes row, so
// the limit stops an unbounded caller filling the table. It isn't brute-force
// protection: the user_code is 40 bits over a 600s TTL and is only accepted at
// /login/device behind a session.
const DEVICE_CODE_LIMIT = 100;
const DEVICE_CODE_WINDOW_MS = 600_000;
const BODY_LIMIT_BYTES = 4096;

export async function POST(req: Request): Promise<Response> {
  const key = `device-code:${clientKey(req)}`;
  const limited = rateLimit(key, DEVICE_CODE_LIMIT, DEVICE_CODE_WINDOW_MS);
  if (!limited.ok) {
    logRateLimitRejection("device-code", key);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  // The body may carry the scan format the CLI writes. A login is refused when the dashboard can't read that format.
  // Any other body under the limit, or none, starts the login.
  const read = await readJsonBody(req, BODY_LIMIT_BYTES);
  if ("tooLarge" in read) return read.tooLarge;
  const { body } = read;
  const scanVersion = body && typeof body === "object" ? (body as { scanVersion?: unknown }).scanVersion : undefined;
  if (typeof scanVersion === "number" && Number.isInteger(scanVersion)) {
    const refusal = versionRefusal(scanVersion, { matchingCli: { version: builtWithCli, command: "auth login" } });
    if (refusal) return NextResponse.json({ error: refusal.code, message: refusal.message }, { status: 409 });
  }

  let deviceCode: string;
  let userCode: string;
  try {
    await pruneDeviceCodes();
    ({ deviceCode, userCode } = await createDeviceCode());
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Use the configured public URL (the one Auth.js uses), not req.url: behind a
  // reverse proxy req.url resolves to the internal pod host, giving an unreachable
  // verification link. Local dev without AUTH_URL falls back to the request origin.
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const base = (process.env["AUTH_URL"] ?? new URL(req.url).origin).replace(/\/+$/, "");
  const verificationUri = `${base}/login/device`;
  const verificationUriComplete = `${verificationUri}?code=${userCode}`;

  return NextResponse.json(
    {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: 600,
      interval: 5,
      warning: dashboardWarning(),
    },
    { status: 201 },
  );
}
