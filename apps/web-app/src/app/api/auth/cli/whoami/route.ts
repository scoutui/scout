import { NextResponse } from "next/server";
import { identify } from "@/lib/identity";

export async function GET(req: Request): Promise<Response> {
  try {
    const identity = await identify({ bearer: req.headers.get("authorization") });
    if (identity?.kind !== "person") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ userId: identity.userId, email: identity.email, role: identity.role });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
