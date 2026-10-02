import { NextResponse } from "next/server";
import { z } from "zod";
import { ScanSummarySchema } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

const ResponseSchema = z.array(ScanSummarySchema);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId); // repoIds may contain "/" (per-app ids)
  const page = await readModelPage(getStorage(), async snapshot => {
    if (!(await snapshot.getRepo(repoId))) return null;
    return snapshot.listScans(repoId);
  });
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  const scans = page.value;
  if (!scans) return NextResponse.json({ error: "repo not found" }, { status: 404 });
  return NextResponse.json(ResponseSchema.parse(scans));
}
