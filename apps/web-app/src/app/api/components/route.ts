import { NextResponse } from "next/server";
import { z } from "zod";
import { ComponentSummarySchema } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";

const ResponseSchema = z.array(ComponentSummarySchema);

export async function GET() {
  const page = await readModelPage(getStorage(), snapshot => snapshot.listComponents());
  if (page.state !== "ready") return NextResponse.json(page, { status: 503 });
  return NextResponse.json(ResponseSchema.parse(page.value));
}
