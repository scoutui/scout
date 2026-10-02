import { revokeCliSession } from "@/lib/cli-session-store";

export async function DELETE(req: Request): Promise<Response> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return new Response(null, { status: 204 });

  try {
    await revokeCliSession(header.slice("Bearer ".length));
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
