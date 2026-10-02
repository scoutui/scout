import { SCHEMA_VERSION } from "@scoutui/scan-format";
import type { StampedMeta } from "../scan/meta.js";
import { parseRetryAfter, UploadError, UploadRefusedError, withTransientRetry } from "../upload.js";
import type { Logger } from "../util/log.js";

/** What the CLI asks the dashboard before it scans: would it take an upload of these commits? */
export type PreScanRequest = {
  repoId: string;
  remote: string | null;
  scanner: string;
  scannerVersion: string;
  schemaVersion: number;
  rescan: boolean;
  commits: string[];
};

/** The dashboard's answer for one commit. */
export type CommitAnswer =
  | { commit: string; decision: "upload" }
  | { commit: string; decision: "skip"; url: string }
  | { commit: string; decision: "refuse"; code: string; message: string };

type Reply = { refusal: { code: string; message: string } | null; commits: CommitAnswer[]; warning: string | null };

/** The pre-scan check's address on the dashboard at `host`. */
export function preScanUrl(host: string): string {
  return `${host.replace(/\/$/, "")}/api/scans/preflight`;
}

/** The pre-scan check's question for a scan, from the metadata it was stamped with. */
export function preScanRequest(meta: StampedMeta, rescan: boolean): PreScanRequest {
  return {
    repoId: meta.repo.id,
    remote: meta.repo.gitRemote,
    scanner: meta.scannerName ?? "",
    scannerVersion: meta.scannerVersion,
    schemaVersion: SCHEMA_VERSION,
    rescan,
    commits: [meta.repo.commit],
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readCommitAnswer(answer: unknown): CommitAnswer | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { commit, decision, url, code, message } = answer as Record<string, unknown>;
  if (typeof commit !== "string") return null;
  if (decision === "upload") return { commit, decision };
  if (decision === "skip" && typeof url === "string") return { commit, decision, url };
  if (decision === "refuse" && typeof code === "string" && typeof message === "string") return { commit, decision, code, message };
  return null;
}

/** The reply's fields, or null when it lacks the shape the dashboard sends, or doesn't answer each commit asked about in order. */
function readReply(body: unknown, commits: readonly string[]): Reply | null {
  if (typeof body !== "object" || body === null) return null;
  const { refusal, commits: answers, warning } = body as Record<string, unknown>;
  const line = warning === null ? null : typeof warning === "string" ? warning : undefined;
  if (line === undefined) return null;
  if (refusal !== null) {
    const { code, message } = (typeof refusal === "object" ? refusal : {}) as Record<string, unknown>;
    return typeof code === "string" && typeof message === "string" ? { refusal: { code, message }, commits: [], warning: line } : null;
  }
  if (!Array.isArray(answers) || answers.length !== commits.length) return null;
  const read: CommitAnswer[] = [];
  for (const [index, answer] of answers.entries()) {
    const commitAnswer = readCommitAnswer(answer);
    if (commitAnswer === null || commitAnswer.commit !== commits[index]) return null;
    read.push(commitAnswer);
  }
  return { refusal: null, commits: read, warning: line };
}

/**
 * Asks the dashboard at `host` whether it would take an upload of `request`'s commits, before anything is scanned, and prints
 * the dashboard's warning line. Returns its answer for each commit, or null when the dashboard doesn't offer the check or its
 * reply can't be read, so the upload checks the scan instead. A refusal of the whole scan throws `UploadRefusedError`; any
 * other status than 200 and 404 throws `UploadError`, as the upload's replies do, once the upload's retries are used up.
 */
export async function checkBeforeScan(opts: { host: string; token: string; request: PreScanRequest; log: Logger }): Promise<CommitAnswer[] | null> {
  const url = preScanUrl(opts.host);
  const { status, text } = await withTransientRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify(opts.request),
    });
    const text = await res.text().catch(() => "");
    if (res.status !== 200 && res.status !== 404) {
      throw new UploadError(res.status, `Pre-scan check failed (${res.status})`, parseRetryAfter(res.headers.get("Retry-After")), text);
    }
    return { status: res.status, text };
  });
  if (status === 404) {
    opts.log.detail(`Skipped the pre-scan check: ${opts.host} doesn't offer it. The upload will check the scan instead.`);
    return null;
  }
  const reply = readReply(parseJson(text), opts.request.commits);
  if (reply === null) {
    opts.log.detail(`Skipped the pre-scan check: ${opts.host}'s reply couldn't be read. The upload will check the scan instead.\n${text}`);
    return null;
  }
  if (reply.warning !== null) opts.log.warn(reply.warning);
  if (reply.refusal !== null) throw new UploadRefusedError(reply.refusal.message, reply.refusal.code, url);
  return reply.commits;
}
