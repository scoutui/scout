import { describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "@scoutui/scan-format";

const line = vi.hoisted(() => "A line from the dashboard.");
vi.mock("@/lib/dashboard-warning", () => ({ dashboardWarning: () => line }));
vi.mock("@/lib/auth", () => ({ verifyUploadBearer: vi.fn(async () => ({ kind: "user", userId: "u1" })) }));
vi.mock("@/db/client", () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock("@/lib/cli-device-codes", () => ({
  createDeviceCode: vi.fn(async () => ({ deviceCode: "dc-plain", userCode: "ABCD-EFGH" })),
  pruneDeviceCodes: vi.fn(async () => {}),
}));

import { POST as deviceCode } from "@/app/api/auth/cli/device-code/route";
import { POST as preflight } from "@/app/api/scans/preflight/route";

const post = (url: string, body: unknown) => new Request(url, {
  method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify(body),
});

const check = (schemaVersion: number) => ({
  repoId: "acme/web", remote: null, scanner: "@scoutui/cli", scannerVersion: "0.10.0", schemaVersion, rescan: false, commits: ["a1c9e04d2f"],
});

describe("the dashboard's warning line", () => {
  it("goes out verbatim with the pre-scan check's answers, refused or not, and with a started login", async () => {
    const replies = [
      await preflight(post("http://x/api/scans/preflight", check(SCHEMA_VERSION))),
      await preflight(post("http://x/api/scans/preflight", check(SCHEMA_VERSION + 1))),
      await deviceCode(post("http://x/api/auth/cli/device-code", {})),
    ];
    const seen = await Promise.all(replies.map(async reply => {
      const body = await reply.json();
      return { status: reply.status, refused: Boolean(body.refusal), warning: body.warning };
    }));
    expect(seen).toEqual([
      { status: 200, refused: false, warning: line },
      { status: 200, refused: true, warning: line },
      { status: 201, refused: false, warning: line },
    ]);
  });
});
