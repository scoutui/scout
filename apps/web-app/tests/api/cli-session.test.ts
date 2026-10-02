import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { hashToken } from "@/lib/cli-session-tokens";

vi.mock("@/lib/cli-session-store", () => ({ revokeCliSession: vi.fn() }));

import { DELETE } from "@/app/api/auth/cli/session/route";
import { revokeCliSession } from "@/lib/cli-session-store";

const validToken = `scout_u_${"a".repeat(43)}`;
const request = (authorization?: string) => new Request("http://x/api/auth/cli/session", {
  method: "DELETE",
  headers: authorization ? { Authorization: authorization } : {},
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("DELETE /api/auth/cli/session", () => {
  it("revokes the bearer session and returns 204", async () => {
    vi.mocked(revokeCliSession).mockResolvedValueOnce(true);
    const response = await DELETE(request(`Bearer ${validToken}`));
    expect(response.status).toBe(204);
    expect(revokeCliSession).toHaveBeenCalledWith(validToken);
  });

  it("answers 204 without revoking when there is no Bearer header", async () => {
    expect((await DELETE(request())).status).toBe(204);
    expect((await DELETE(request("Basic x"))).status).toBe(204);
    expect(revokeCliSession).not.toHaveBeenCalled();
  });

  it("always answers 204 for a Bearer header, whatever the store does with the token", async () => {
    expect((await DELETE(request("Bearer garbage"))).status).toBe(204);
    expect(revokeCliSession).toHaveBeenCalledWith("garbage");
  });

  it("returns 500 for a database error", async () => {
    const hash = hashToken(validToken);
    vi.mocked(revokeCliSession).mockRejectedValueOnce(new DrizzleQueryError("revoke session", [hash], new Error(validToken)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await DELETE(request(`Bearer ${validToken}`));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"server_error"}');
    expect(body).not.toContain(validToken);
    expect(body).not.toContain(hash);
    expect(logged).not.toHaveBeenCalled();
  });
});
