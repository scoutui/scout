import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/cli-session-store", () => ({ resolveCliSession: vi.fn() }));

import { verifyUploadBearer } from "@/lib/auth";
import { resolveCliSession } from "@/lib/cli-session-store";

const validUserToken = `scout_u_${"a".repeat(43)}`;

// biome-ignore lint/complexity/useLiteralKeys: env access
const SAVED = process.env["SCOUTUI_CI_UPLOAD_TOKEN"];

beforeEach(() => {
  vi.clearAllMocks();
  // biome-ignore lint/complexity/useLiteralKeys: env access
  process.env["SCOUTUI_CI_UPLOAD_TOKEN"] = "ci-secret";
});
afterEach(() => {
  if (SAVED === undefined) Reflect.deleteProperty(process.env, "SCOUTUI_CI_UPLOAD_TOKEN");
  // biome-ignore lint/complexity/useLiteralKeys: env access
  else process.env["SCOUTUI_CI_UPLOAD_TOKEN"] = SAVED;
});

describe("verifyUploadBearer", () => {
  it("uses the CI secret before resolving a user session", async () => {
    const id = await verifyUploadBearer("Bearer ci-secret");
    expect(id).toEqual({ kind: "ci" });
    expect(resolveCliSession).not.toHaveBeenCalled();
  });

  it("maps a resolved CLI session to the user upload identity", async () => {
    vi.mocked(resolveCliSession).mockResolvedValue({ sessionId: "s1", userId: "u1", email: "ben@example.com" });
    const id = await verifyUploadBearer(`Bearer ${validUserToken}`);
    expect(id).toEqual({ kind: "user", userId: "u1" });
    expect(resolveCliSession).toHaveBeenCalledWith(validUserToken);
  });

  it("returns null for an unknown session", async () => {
    vi.mocked(resolveCliSession).mockResolvedValue(null);
    expect(await verifyUploadBearer(`Bearer ${validUserToken}`)).toBeNull();
  });

  it("returns null without a Bearer prefix", async () => {
    expect(await verifyUploadBearer(null)).toBeNull();
    expect(await verifyUploadBearer("Basic x")).toBeNull();
  });

  it("does not match a different-length token (timing-safe guard)", async () => {
    const id = await verifyUploadBearer("Bearer ci-secret-longer");
    expect(id).toBeNull();
  });

  it("disables the CI path when SCOUTUI_CI_UPLOAD_TOKEN is unset", async () => {
    Reflect.deleteProperty(process.env, "SCOUTUI_CI_UPLOAD_TOKEN");
    const id = await verifyUploadBearer("Bearer ci-secret");
    expect(id).toBeNull();
  });
});
