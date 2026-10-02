import { SCHEMA_VERSION } from "@scoutui/scan-format";

export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
  /** A line from the dashboard for the CLI to print, or null. */
  warning: string | null;
};

export type UserSession = {
  token: string;
  email: string;
};

export type PollResult =
  | { kind: "session"; session: UserSession }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "expired" }
  | { kind: "denied" };

export class AuthHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AuthProtocolError extends Error {}

/** The dashboard won't start a sign-in for this CLI, with its own message and code. */
export class SignInRefusedError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "unknown_error";
}

const USER_SESSION_TOKEN_PATTERN = /^scout_u_[A-Za-z0-9_-]{43}$/;

function toUserSession(body: unknown): UserSession {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AuthProtocolError("Invalid token response: missing session.");
  }
  const { access_token: token, token_type: tokenType, email } = body as Record<string, unknown>;
  if (typeof token !== "string" || !USER_SESSION_TOKEN_PATTERN.test(token) || tokenType !== "Bearer" || typeof email !== "string" || email.trim() === "") {
    throw new AuthProtocolError("Invalid token response: malformed session.");
  }
  return { token, email };
}

/**
 * Starts a sign-in, telling the dashboard which scan format this CLI writes. A dashboard that can't read that format answers
 * 409: `SignInRefusedError` carries its message, or `AuthHttpError` when the message can't be read.
 */
export async function requestDeviceCode(base: string): Promise<DeviceCodeResponse> {
  const res = await fetch(endpoint(base, "/api/auth/cli/device-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanVersion: SCHEMA_VERSION }),
  });
  if (res.status === 409) {
    const body: unknown = await res.json().catch(() => null);
    const { error, message } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (typeof error === "string" && typeof message === "string" && message !== "") throw new SignInRefusedError(message, error);
    throw new AuthHttpError(409, "device-code refused with a reply that couldn't be read");
  }
  if (!res.ok) throw new AuthHttpError(res.status, `device-code failed: ${await readError(res)}`);
  const b = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
    warning?: unknown;
  };
  return {
    deviceCode: b.device_code,
    userCode: b.user_code,
    verificationUri: b.verification_uri,
    verificationUriComplete: b.verification_uri_complete,
    expiresIn: b.expires_in,
    interval: b.interval,
    warning: typeof b.warning === "string" ? b.warning : null,
  };
}

export async function pollToken(base: string, deviceCode: string): Promise<PollResult> {
  const res = await fetch(endpoint(base, "/api/auth/cli/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
  if (res.ok) {
    const body: unknown = await res.json().catch(() => {
      throw new AuthProtocolError("Invalid token response: could not parse JSON.");
    });
    return { kind: "session", session: toUserSession(body) };
  }
  const error = await readError(res);
  switch (error) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down" };
    case "expired_token":
      return { kind: "expired" };
    case "access_denied":
      return { kind: "denied" };
    default:
      throw new AuthHttpError(res.status, `token poll failed: ${error}`);
  }
}

export async function revokeSession(base: string, token: string): Promise<void> {
  const res = await fetch(endpoint(base, "/api/auth/cli/session"), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 204) throw new AuthHttpError(res.status, `session revoke failed: ${await readError(res)}`);
}

export async function whoami(
  base: string,
  token: string,
): Promise<{ userId: string; email: string | null } | null> {
  const res = await fetch(endpoint(base, "/api/auth/cli/whoami"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthHttpError(res.status, `whoami failed: ${await readError(res)}`);
  const body: unknown = await res.json().catch(() => {
    throw new AuthProtocolError("Invalid whoami response: could not parse JSON.");
  });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AuthProtocolError("Invalid whoami response: missing identity.");
  }
  const { userId, email } = body as Record<string, unknown>;
  if (typeof userId !== "string" || userId === "" || (typeof email !== "string" && email !== null)) {
    throw new AuthProtocolError("Invalid whoami response: malformed identity.");
  }
  return { userId, email };
}
