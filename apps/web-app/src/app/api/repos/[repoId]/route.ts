import { NextResponse } from "next/server";
import { RepoDetailSchema } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId); // repoIds may contain "/" (per-app ids)
  const rawScan = new URL(req.url).searchParams.get("scan");
  // Treat `?scan=` (empty) the same as no scan param at all, matching the page.
  const scanId = rawScan && rawScan.length > 0 ? rawScan : undefined;
  const page = await readModelPage(getStorage(), snapshot => snapshot.getRepo(repoId, scanId));
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  const detail = page.value;
  if (!detail) {
    const message = scanId ? "scan not found" : "repo not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json(RepoDetailSchema.parse(detail));
}
