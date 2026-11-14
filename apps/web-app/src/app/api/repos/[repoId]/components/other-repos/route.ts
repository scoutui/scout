import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId);
  const scanId = new URL(req.url).searchParams.get("scan") ?? "";
  if (!scanId) return NextResponse.json({ error: "scan is required" }, { status: 400 });
  const page = await readModelPage(getStorage(), (snapshot) => snapshot.getOtherRepoCounts(repoId, scanId));
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  if (!page.value) return NextResponse.json({ error: "scan not found" }, { status: 404 });
  return NextResponse.json(page.value);
}
