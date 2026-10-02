import { NextResponse } from "next/server";
import { z } from "zod";
import { ComponentRowSchema } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

const ResponseSchema = z.array(ComponentRowSchema);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId); // repoIds may contain "/" (per-app ids)
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const page = await readModelPage(getStorage(), async snapshot => {
    if (!(await snapshot.getRepo(repoId))) return null;
    return snapshot.listComponentsForRepo(repoId, q);
  });
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  const rows = page.value;
  if (!rows) return NextResponse.json({ error: "repo not found" }, { status: 404 });
  return NextResponse.json(ResponseSchema.parse(rows));
}
