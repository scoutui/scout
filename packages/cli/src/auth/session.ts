import { loadStore, mutateStore, normalizeHost, type HostEntry, type Store } from "./store.js";

export class NotSignedInError extends Error {
  constructor(public host: string) {
    super(`Not signed in to ${host}. Run scout auth login --host ${host}.`);
  }
}

export class ReloginRequiredError extends Error {
  constructor(public host: string) {
    super(`Session for ${host} is no longer valid. Run scout auth login --host ${host}.`);
  }
}

export class SessionChangedError extends Error {
  constructor(public host: string) {
    super("Your sign-in changed during the upload. Try again.");
  }
}

export class HostUnavailableError extends Error {
  constructor(public host: string) {
    super(`Couldn't reach ${host}. Check your connection and try again.`);
  }
}

/** The dashboard rejected `SCOUTUI_TOKEN`. */
export class TokenRejectedError extends Error {
  constructor() {
    super("Couldn't upload the scan: the dashboard rejected SCOUTUI_TOKEN. Check that it matches the dashboard's upload token.");
  }
}

export class NoHostError extends Error {}

/** Host precedence: flag → SCOUTUI_HOST → repo config → stored default. Returns a normalized base URL. */
export function resolveHost(opts: {
  flagHost?: string | undefined;
  configHost?: string | undefined;
  env?: NodeJS.ProcessEnv;
  store: Store;
}): string {
  const env = opts.env ?? process.env;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const raw = opts.flagHost ?? (env["SCOUTUI_HOST"] || undefined) ?? opts.configHost ?? opts.store.default;
  if (!raw) throw new NoHostError();
  return normalizeHost(raw);
}

export async function getStoredSession(host: string, deps: { filePath?: string } = {}): Promise<HostEntry> {
  const base = normalizeHost(host);
  const store = await loadStore(deps.filePath);
  const entry = store.hosts[base];
  if (!entry) throw new NotSignedInError(base);
  return entry;
}

export async function setStoredSession(host: string, entry: HostEntry, deps: { filePath?: string } = {}): Promise<void> {
  const base = normalizeHost(host);
  await mutateStore((store) => {
    store.hosts[base] = entry;
    if (!store.default) store.default = base;
    return { changed: true, result: undefined };
  }, deps.filePath);
}

export async function removeStoredSession(host: string, deps: { expectedToken: string; filePath?: string }): Promise<boolean> {
  const base = normalizeHost(host);
  return await mutateStore((store) => {
    if (store.hosts[base]?.token !== deps.expectedToken) return { changed: false, result: false };
    const { [base]: _removed, ...hosts } = store.hosts;
    store.hosts = hosts;
    if (store.default === base) store.default = undefined;
    return { changed: true, result: true };
  }, deps.filePath);
}

/** Map an auth error to friendly copy, or null if it is not an auth error. */
export function formatAuthError(err: unknown): string | null {
  return err instanceof NotSignedInError || err instanceof ReloginRequiredError || err instanceof SessionChangedError || err instanceof HostUnavailableError || err instanceof TokenRejectedError
    ? err.message
    : null;
}
