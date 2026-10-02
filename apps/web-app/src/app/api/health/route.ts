import { NextResponse } from "next/server";

// Kubernetes liveness and readiness target. It doesn't touch the database:
// restarting a pod can't fix a Postgres outage, so a database check here would
// turn a database blip into a restart loop across every replica.
//
// Unauthenticated: `api/health` is excluded from the middleware matcher in
// src/middleware.ts. It exposes nothing beyond "this process is serving".
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
