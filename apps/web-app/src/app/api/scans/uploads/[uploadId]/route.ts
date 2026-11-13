import { NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { can, type Identity } from "@/lib/access";
import { identify } from "@/lib/identity";
import { TOKEN_REFUSAL } from "@/lib/repo-upload-tokens";
import { errorClass, getUploadStatus } from "@/lib/scan-jobs";

async function caller(req: Request): Promise<Identity | null> {
  const header = req.headers.get("authorization");
  return header ? identify({ bearer: header }) : identify({ browser: true });
}

export async function GET(req: Request, { params }: { params: Promise<{ uploadId: string }> }): Promise<Response> {
  let identity: Identity | null;
  try {
    identity = await caller(req);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (identity?.kind === "guest" || (!can(identity, "view") && !can(identity, "upload"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { uploadId } = await params;
  let status: Awaited<ReturnType<typeof getUploadStatus>>;
  try {
    status = await getUploadStatus(getPool(), uploadId, identity?.kind === "repo-token" ? identity.repoId : null);
  } catch (error) {
    console.error(`[scans] upload status failed: ${errorClass(error)}`);
    return NextResponse.json({ error: "upload status unavailable; retry later" }, {
      status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" },
    });
  }
  if (!status) {
    return NextResponse.json({ error: "upload not found" }, { status: 404 });
  }
  if (identity?.kind === "repo-token" && status.error?.code === TOKEN_REFUSAL.code) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
