import { NextResponse } from "next/server";
import { CrossRepoComponentDetailSchema } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

export async function GET(_req: Request, { params }: { params: Promise<{ componentId: string }> }) {
  const { componentId } = await params;
  const page = await readModelPage(getStorage(), (snapshot) => snapshot.getCrossRepoComponent(decodeURIComponent(componentId)));
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  if (!page.value) return NextResponse.json({ error: "component not found" }, { status: 404 });
  return NextResponse.json(CrossRepoComponentDetailSchema.parse(page.value));
}
