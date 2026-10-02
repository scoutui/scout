import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cli-session-store", () => ({ resolveCliSession: vi.fn() }));

import { verifyBearer } from "@/lib/auth";
import { resolveCliSession } from "@/lib/cli-session-store";

const validUserToken = `scout_u_${"a".repeat(43)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveCliSession).mockResolvedValue(null);
});

describe("verifyBearer", () => {
  it("returns null without a Bearer prefix, before resolving a session", async () => {
    expect(await verifyBearer(null)).toBeNull();
    expect(await verifyBearer("no-bearer-prefix")).toBeNull();
    expect(resolveCliSession).not.toHaveBeenCalled();
  });
  it("passes the token after \"Bearer \" to the session store and returns its result", async () => {
    vi.mocked(resolveCliSession).mockResolvedValue({
      sessionId: "s1", userId: "u1", email: "ben@example.com",
    });
    expect(await verifyBearer(`Bearer ${validUserToken}`)).toEqual({
      sessionId: "s1", userId: "u1", email: "ben@example.com",
    });
    expect(resolveCliSession).toHaveBeenCalledWith(validUserToken);
  });
  it("returns null for an unknown session", async () => {
    vi.mocked(resolveCliSession).mockResolvedValue(null);
    expect(await verifyBearer(`Bearer ${validUserToken}`)).toBeNull();
  });
});
