import { NextResponse } from "next/server";

function describeLimit(bytes: number): string {
  const mib = 1024 * 1024;
  return bytes % mib === 0 ? `${bytes / mib} MiB` : `${bytes} bytes`;
}

export function tooLarge(subject: string, bytes: number): Response {
  return NextResponse.json({ error: `${subject} too large (limit ${describeLimit(bytes)})` }, { status: 413 });
}

/**
 * Reads a JSON request body of at most `maxBytes`, stopping as soon as it passes the limit. `body` is undefined when the
 * request has no body or it isn't JSON; `tooLarge` is the 413 reply for a body over the limit.
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<{ body: unknown } | { tooLarge: Response }> {
  if (Number(req.headers.get("content-length") ?? "0") > maxBytes) return { tooLarge: tooLarge("payload", maxBytes) };
  if (!req.body) return { body: undefined };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        reader.cancel().catch(() => {});
        return { tooLarge: tooLarge("payload", maxBytes) };
      }
      chunks.push(value);
    }
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { body: undefined };
  }
}
