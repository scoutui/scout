import { NextResponse } from "next/server";
import { verifyBearer } from "@/lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const identity = await verifyBearer(req.headers.get("authorization"));
    if (!identity) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ userId: identity.userId, email: identity.email });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
