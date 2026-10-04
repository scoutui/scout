import { afterEach, describe, it, expect, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { hashToken } from "@/lib/cli-session-tokens";

vi.mock("@/lib/identity", () => ({ identify: vi.fn(async () => null) }));

import { GET } from "@/app/api/auth/cli/whoami/route";
import { identify } from "@/lib/identity";

afterEach(() => vi.restoreAllMocks());

describe("GET /api/auth/cli/whoami", () => {
  it.each([
    ["nobody", null],
    ["the CI upload secret", { kind: "ci" as const }],
  ])("returns 401 for %s", async (_, identity) => {
    vi.mocked(identify).mockResolvedValueOnce(identity);
    const req = new Request("http://x/api/auth/cli/whoami");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 with the person's userId, email and role", async () => {
    vi.mocked(identify).mockResolvedValueOnce({ kind: "person", userId: "u1", email: "ben@example.com", name: null, role: "editor", roleSource: "people" });
    const req = new Request("http://x/api/auth/cli/whoami", {
      headers: { Authorization: "Bearer x" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ userId: "u1", email: "ben@example.com", role: "editor" });
  });

  it("returns a generic server error without logging a failed credential query", async () => {
    const raw = `scout_u_${"a".repeat(43)}`;
    const hash = hashToken(raw);
    vi.mocked(identify).mockRejectedValueOnce(new DrizzleQueryError("resolve session", [hash], new Error(raw)));
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
