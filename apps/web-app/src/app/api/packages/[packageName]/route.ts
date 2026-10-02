import { NextResponse } from "next/server";
import { PackageDetailSchema, resolveTags } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ packageName: string }> },
) {
  const { packageName } = await params;
  // Scoped packages arrive URL-encoded (`%40example%2Fui`) because `%2F`
  // stays encoded in a single dynamic segment. Decode before lookup.
  const page = await readModelPage(getStorage(), async snapshot => ({
    pkg: await snapshot.getPackage(decodeURIComponent(packageName)), tags: await snapshot.listTags(),
  }));
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  const { pkg, tags } = page.value;
  if (!pkg) {
    return NextResponse.json({ error: "package not found" }, { status: 404 });
  }
  const detail = { ...pkg, tags: resolveTags(pkg.packageName, tags) };
  return NextResponse.json(PackageDetailSchema.parse(detail));
}
