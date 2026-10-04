import { NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";
import { errorClass, getUploadStatus } from "@/lib/scan-jobs";

async function authorized(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization");
  const identity = header ? await identify({ bearer: header }) : await identify({ browser: true });
  return can(identity, "view") || can(identity, "upload");
}

export async function GET(req: Request, { params }: { params: Promise<{ uploadId: string }> }): Promise<Response> {
  try {
    if (!await authorized(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  const { uploadId } = await params;
  let status: Awaited<ReturnType<typeof getUploadStatus>>;
  try {
    status = await getUploadStatus(getPool(), uploadId);
  } catch (error) {
    console.error(`[scans] upload status failed: ${errorClass(error)}`);
    return NextResponse.json({ error: "upload status unavailable; retry later" }, {
      status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" },
    });
  }
  if (!status) {
    return NextResponse.json({ error: "upload not found" }, { status: 404 });
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
