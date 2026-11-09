import { afterEach, describe, expect, it, vi } from "vitest";
import { type NextFetchEvent, NextRequest } from "next/server";

type Handler = (req: NextRequest & { auth: unknown }, event: NextFetchEvent) => Response;
const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("@/auth", () => ({
  auth: (handler: Handler) => (req: NextRequest, event: NextFetchEvent) => handler(Object.assign(req, { auth: session.current }), event),
}));

import middleware from "@/middleware";

async function visit(path: string): Promise<{ status: number; location: string | null }> {
  const res = (await middleware(new NextRequest(`http://localhost:3000${path}`), {} as NextFetchEvent)) as Response;
  return { status: res.status, location: res.headers.get("location") };
}

describe("middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    session.current = null;
  });

  it.each([
    { guestView: undefined, path: "/repos/repo-a", sends: "http://localhost:3000/login?callbackUrl=%2Frepos%2Frepo-a" },
    { guestView: "false", path: "/charts", sends: "http://localhost:3000/login?callbackUrl=%2Fcharts" },
    { guestView: "true", path: "/repos/repo-a", sends: null },
    { guestView: "true", path: "/charts", sends: null },
    { guestView: "true", path: "/", sends: "http://localhost:3000/repos" },
    { guestView: "true", path: "/login", sends: null },
    { guestView: "true", path: "/login/device?code=ABCD-EFGH", sends: "http://localhost:3000/login?callbackUrl=%2Flogin%2Fdevice%3Fcode%3DABCD-EFGH" },
  ])("with SCOUTUI_GUEST_VIEW $guestView, sends a visitor without a session at $path to $sends", async ({ guestView, path, sends }) => {
    vi.stubEnv("SCOUTUI_GUEST_VIEW", guestView);
    expect((await visit(path)).location).toBe(sends);
  });

  it("lets a signed-in person through to /login/device with guest view on", async () => {
    vi.stubEnv("SCOUTUI_GUEST_VIEW", "true");
    session.current = { user: { id: "ana" } };
    expect((await visit("/login/device?code=ABCD-EFGH")).location).toBeNull();
  });
});
