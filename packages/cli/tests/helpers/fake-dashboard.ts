import { vi } from "vitest";

type FetchArgs = Parameters<typeof fetch>;
type PreScanAnswer = { decision: "upload" } | { decision: "skip"; url: string } | { decision: "refuse"; code: string; message: string };

/** A `fetch` implementation answering the pre-scan check: `answer` for each commit the request asks about, with no warning. */
export function preScanReply(answer: PreScanAnswer = { decision: "upload" }) {
  return async (_input: FetchArgs[0], init?: FetchArgs[1]): Promise<Response> => {
    const { commits } = JSON.parse(String(init?.body)) as { commits: string[] };
    return Response.json({ refusal: null, commits: commits.map((commit) => ({ commit, ...answer })), warning: null });
  };
}

/**
 * Stands in for a dashboard that takes every scan: the pre-scan check answers upload, an upload is received as U1, and its
 * status is ready as scan S1. Returns the `fetch` spy.
 */
export function acceptingDashboard() {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/api/scans/preflight") return await preScanReply()(input, init);
    if (pathname === "/api/scans") return Response.json({ uploadId: "U1", statusUrl: "/api/scans/uploads/U1" }, { status: 202 });
    return Response.json({ state: "ready", readable: true, scanId: "S1", url: "/repos/r/scans/S1" });
  });
}
