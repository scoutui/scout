import { loadStore } from "./store.js";
import { resolveHost, getStoredSession, removeStoredSession, ReloginRequiredError, SessionChangedError, TokenRejectedError } from "./session.js";
import { submitArtifact, pollUpload, UploadError, type UploadResult, type UploadStatus } from "../upload.js";
import type { Logger } from "../util/log.js";
import { checkBeforeScan, type CommitAnswer, type PreScanRequest } from "../upload-policy/dashboard.js";

export type AuthedUploader = {
  base: string;
  /** The pre-scan check: the dashboard's answer for each commit, or null when it can't answer. See `checkBeforeScan`. */
  check: (request: PreScanRequest, log: Logger) => Promise<CommitAnswer[] | null>;
  upload: (artifactJson: string, options?: { rescan?: boolean }) => Promise<UploadResult>;
};

export async function createAuthedUploader(opts: {
  flagHost?: string;
  configHost?: string;
  store?: { filePath?: string };
  onStatus?: (status: UploadStatus) => void;
}): Promise<AuthedUploader> {
  const filePath = opts.store?.filePath;
  const store = await loadStore(filePath);
  const base = resolveHost({
    ...(opts.flagHost !== undefined ? { flagHost: opts.flagHost } : {}),
    ...(opts.configHost !== undefined ? { configHost: opts.configHost } : {}),
    store,
  });
  const { SCOUTUI_TOKEN: ciToken } = process.env;
  const session = filePath !== undefined ? { filePath } : {};
  const token = ciToken || (await getStoredSession(base, session)).token;
  async function onUnauthorized(): Promise<never> {
    if (ciToken) throw new TokenRejectedError();
    const removed = await removeStoredSession(base, { expectedToken: token, ...session });
    if (!removed) throw new SessionChangedError(base);
    throw new ReloginRequiredError(base);
  }
  return {
    base,
    async check(request: PreScanRequest, log: Logger): Promise<CommitAnswer[] | null> {
      return await checkBeforeScan({ host: base, token, request, log }).catch(async (err: unknown) => {
        if (!(err instanceof UploadError) || err.code !== 401) throw err;
        return await onUnauthorized();
      });
    },
    async upload(artifactJson: string, options: { rescan?: boolean } = {}): Promise<UploadResult> {
      const receipt = await submitArtifact({ host: base, token, artifactJson, rescan: options.rescan === true }).catch(async (err: unknown) => {
        if (!(err instanceof UploadError) || err.code !== 401) throw err;
        return await onUnauthorized();
      });
      return await pollUpload({
        host: base, receipt, getToken: async () => token, onUnauthorized,
        timeoutMs: 300_000,
        ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
      });
    },
  };
}
