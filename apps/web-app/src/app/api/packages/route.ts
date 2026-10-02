import { NextResponse } from "next/server";
import { z } from "zod";
import { PackageSummarySchema, attachTags } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

const ResponseSchema = z.array(PackageSummarySchema);

export async function GET() {
  const page = await readModelPage(getStorage(), async snapshot => ({
    rows: await snapshot.listPackages(), tags: await snapshot.listTags(),
  }));
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  const { rows, tags } = page.value;
  return NextResponse.json(ResponseSchema.parse(attachTags(rows, tags)));
}
