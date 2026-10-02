import { afterEach, describe, it, expect, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { hashToken } from "@/lib/cli-session-tokens";

vi.mock("@/lib/auth", () => ({ verifyBearer: vi.fn(async () => null) }));

import { GET } from "@/app/api/auth/cli/whoami/route";
import { verifyBearer } from "@/lib/auth";

afterEach(() => vi.restoreAllMocks());

describe("GET /api/auth/cli/whoami", () => {
  it("returns 401 when verifyBearer returns null", async () => {
    vi.mocked(verifyBearer).mockResolvedValueOnce(null);
    const req = new Request("http://x/api/auth/cli/whoami");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 with userId and email when authenticated", async () => {
    vi.mocked(verifyBearer).mockResolvedValueOnce({ sessionId: "s1", userId: "u1", email: "ben@example.com" });
    const req = new Request("http://x/api/auth/cli/whoami", {
      headers: { Authorization: "Bearer x" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ userId: "u1", email: "ben@example.com" });
  });

  it("returns a generic server error without logging a failed credential query", async () => {
    const raw = `scout_u_${"a".repeat(43)}`;
    const hash = hashToken(raw);
    vi.mocked(verifyBearer).mockRejectedValueOnce(new DrizzleQueryError("resolve session", [hash], new Error(raw)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new Request("http://x/api/auth/cli/whoami", {
      headers: { Authorization: `Bearer ${raw}` },
    }));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"server_error"}');
    expect(body).not.toContain(raw);
    expect(body).not.toContain(hash);
    expect(logged).not.toHaveBeenCalled();
  });

});
