import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { componentPanelFacts } from "@/lib/component-panel";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string; componentId: string }> },
) {
  const { repoId: rawRepoId, componentId: rawComponentId } = await params;
  const repoId = decodeURIComponent(rawRepoId);
  const componentId = decodeURIComponent(rawComponentId);
  const scanId = new URL(req.url).searchParams.get("scan") ?? "";
  if (!scanId) return NextResponse.json({ error: "scan is required" }, { status: 400 });
  const page = await readModelPage(getStorage(), (snapshot) => componentPanelFacts(snapshot, repoId, scanId, componentId));
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  if (!page.value) return NextResponse.json({ error: "component not found" }, { status: 404 });
  return NextResponse.json(page.value);
}
