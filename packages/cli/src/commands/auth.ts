import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { InvalidHostError, isValidUrl, loadStore, normalizeHost, StoreLockError, tokenStorage, type HostEntry } from "../auth/store.js";
import { hostsFilePath } from "../auth/paths.js";
import { requestDeviceCode, pollToken, whoami, revokeSession, AuthHttpError, AuthProtocolError, SignInRefusedError, type DashboardRole } from "../auth/client.js";
import { openBrowser } from "../auth/browser.js";
import { resolveHost, getStoredSession, setStoredSession, removeStoredSession, ReloginRequiredError, HostUnavailableError, NoHostError, formatAuthError } from "../auth/session.js";
import { parseCommand } from "../cli/parse.js";
import { assertNotCancelled, PromptCancelledError, type PromptAdapter } from "../prompts/adapter.js";
import { Logger } from "../util/log.js";
import { startPhase } from "../util/progress.js";
import { symbol } from "../util/style.js";
import { ConfigError, loadConfig } from "../config/loader.js";
import { withDocsLink } from "../upload.js";

type StoreOpt = { filePath?: string };

const out = (s: string) => process.stdout.write(s);

/** `--debug` detail for a failed request: the HTTP status and reply, the reason, or the network error. */
function requestDetail(e: unknown): string | undefined {
  if (e instanceof AuthHttpError) return `HTTP ${e.status}: ${e.message}`;
  if (e instanceof AuthProtocolError) return e.message;
  return transportDetail(e);
}

const UNEXPECTED_REPLY = "sent an unexpected reply. Check that it's your Scout dashboard and that the CLI is up to date.";

const ROLE_PHRASE: Record<DashboardRole, string> = { viewer: "a Viewer", editor: "an Editor", admin: "an Admin" };

function asRole(role: DashboardRole | null): string {
  return role === null ? "" : ` as ${ROLE_PHRASE[role]}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best transport-failure detail: the cause's syscall code, else its message, else the error's own message. */
function transportDetail(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  const cause = e.cause as { code?: unknown; message?: unknown } | undefined;
  if (cause && typeof cause.code === "string" && cause.code !== "") return cause.code;
  if (cause && typeof cause.message === "string" && cause.message !== "") return cause.message;
  return e.message === "" ? undefined : e.message;
}

/** A path under the home directory, shown as `~/…`. */
function displayPath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

export async function runAuthLogin(opts: {
  host: string;
  store?: StoreOpt;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: Logger;
}): Promise<number> {
  const base = normalizeHost(opts.host);
  const log = opts.log ?? new Logger();
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const filePath = opts.store?.filePath;

  const stored = (await loadStore(filePath)).hosts[base];
  if (stored) {
    try {
      const identity = await whoami(base, stored.token);
      if (identity) {
        out(`Already signed in as ${identity.email ?? stored.userEmail} to ${base}${asRole(identity.role)}.\n`);
        return 0;
      }
      const removed = await removeStoredSession(base, { expectedToken: stored.token, ...(filePath !== undefined ? { filePath } : {}) });
      if (!removed) {
        log.error(`Session for ${base} changed while checking it. Run scout auth login --host ${base} again.`);
        return 1;
      }
    } catch (e) {
      if (e instanceof StoreLockError) log.error(e.message);
      else if (e instanceof AuthHttpError) log.error(`Couldn't sign in: ${base} returned an error. Try again later.`, requestDetail(e));
      else if (e instanceof AuthProtocolError) log.error(`Couldn't sign in: ${base} ${UNEXPECTED_REPLY}`, requestDetail(e));
      else log.error(new HostUnavailableError(base).message, requestDetail(e));
      return 1;
    }
  }

  let device: Awaited<ReturnType<typeof requestDeviceCode>>;
  try {
    device = await requestDeviceCode(base);
  } catch (e) {
    if (e instanceof SignInRefusedError) log.error(withDocsLink(e.message, e.code));
    else if (e instanceof AuthHttpError && e.status === 409) log.error(`Couldn't sign in: ${base} returned an error. Try again later.`, requestDetail(e));
    else if (e instanceof AuthHttpError) log.error(`Couldn't sign in: ${base} returned an error. Check the address and try again.`, requestDetail(e));
    else log.error(`Couldn't reach ${base}. Check your connection and try again.`, requestDetail(e));
    return 1;
  }
  if (device.warning !== null) log.warn(device.warning);
  out(`To sign in, open:\n  ${log.color.brand(device.verificationUri)}\nCode: ${log.color.bold(device.userCode)}\n`);
  if (openBrowser(device.verificationUriComplete, base)) out("Opened your browser…\n");
  // When styled, a spinner turns on stderr while Scout waits; otherwise the result follows on the same line.
  const waiting = log.styled
    ? startPhase({ label: "Waiting for approval…", writer: (s) => process.stderr.write(s), isTTY: true, columns: process.stderr.columns, motion: log.color })
    : undefined;
  if (waiting === undefined) out("Waiting for approval… ");
  const stopWaiting = (): void => {
    if (waiting === undefined) out("\n");
    else waiting.done();
  };

  let intervalMs = device.interval * 1000;
  const deadline = now() + device.expiresIn * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    let result: Awaited<ReturnType<typeof pollToken>>;
    try {
      result = await pollToken(base, device.deviceCode);
    } catch (e) {
      stopWaiting();
      if (e instanceof AuthHttpError) log.error(`Couldn't sign in: ${base} returned an error. Run scout auth login again.`, requestDetail(e));
      else if (e instanceof AuthProtocolError) log.error(`Couldn't sign in: ${base} ${UNEXPECTED_REPLY}`, requestDetail(e));
      else log.error(`Couldn't reach ${base}. Check your connection, then run scout auth login again.`, requestDetail(e));
      return 1;
    }
    if (result.kind === "session") {
      const entry: HostEntry = {
        token: result.session.token,
        userEmail: result.session.email,
      };
      await setStoredSession(base, entry, filePath !== undefined ? { filePath } : {});
      waiting?.done();
      out(`${symbol(log.color, "success")} Signed in as ${entry.userEmail || "your account"} to ${base}${asRole(result.session.role)}.\n`);
      if (await tokenStorage(base, filePath) === "hosts.json") {
        log.warn(`Couldn't save your session to the system keychain, so it was saved to ${displayPath(filePath ?? hostsFilePath())} instead.`);
      }
      return 0;
    }
    if (result.kind === "slow_down") {
      intervalMs += 5_000;
      continue;
    }
    if (result.kind === "expired") {
      stopWaiting();
      log.error("Code expired. Run scout auth login again.");
      return 1;
    }
    if (result.kind === "denied") {
      stopWaiting();
      log.error("Couldn't sign in: the request was denied on the dashboard. Run scout auth login to try again.");
      return 1;
    }
    // pending → keep polling
  }
  stopWaiting();
  log.error("Timed out waiting for approval. Run scout auth login again.");
  return 1;
}

export async function runAuthStatus(opts: {
  host?: string;
  configHost?: string | undefined;
  store?: StoreOpt;
  env?: NodeJS.ProcessEnv;
  write?: (s: string) => void;
  log?: Logger;
}): Promise<number> {
  const write = opts.write ?? out;
  const log = opts.log ?? new Logger();
  const filePath = opts.store?.filePath;
  const store = await loadStore(filePath);
  let base: string;
  try {
    base = resolveHost({ flagHost: opts.host, configHost: opts.configHost, env: opts.env ?? process.env, store });
  } catch (e) {
    if (!(e instanceof NoHostError)) throw e;
    write("Not signed in.\n");
    return 1;
  }
  const entry = store.hosts[base];
  if (!entry) {
    write(`Not signed in to ${base}.\n`);
    return 1;
  }
  try {
    const { token, userEmail } = await getStoredSession(base, filePath !== undefined ? { filePath } : {});
    const who = await whoami(base, token);
    if (!who) {
      const removed = await removeStoredSession(base, { expectedToken: token, ...(filePath !== undefined ? { filePath } : {}) });
      log.error(removed
        ? new ReloginRequiredError(base).message
        : `Your sign-in changed while checking it. Run scout auth status --host ${base} again.`);
      return 1;
    }
    const storage = await tokenStorage(base, filePath);
    const savedIn = storage === "keychain" ? "the system keychain" : displayPath(filePath ?? hostsFilePath());
    write(`Signed in as ${who.email ?? userEmail} to ${base}${asRole(who.role)}${storage ? ` (session saved in ${savedIn})` : ""}.\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof StoreLockError ? e.message : formatAuthError(e) ?? (e instanceof AuthHttpError
      ? `Couldn't check your session: ${base} returned an error. Try again later.`
      : e instanceof AuthProtocolError
        ? `Couldn't check your session: ${base} ${UNEXPECTED_REPLY}`
        : new HostUnavailableError(base).message);
    log.error(msg, requestDetail(e));
    return 1;
  }
}

export async function runAuthLogout(opts: {
  host?: string;
  configHost?: string | undefined;
  store?: StoreOpt;
  env?: NodeJS.ProcessEnv;
  write?: (s: string) => void;
  log?: Logger;
}): Promise<number> {
  const write = opts.write ?? out;
  const log = opts.log ?? new Logger();
  const filePath = opts.store?.filePath;
  const store = await loadStore(filePath);
  let base: string;
  try {
    base = resolveHost({ flagHost: opts.host, configHost: opts.configHost, env: opts.env ?? process.env, store });
  } catch (e) {
    if (!(e instanceof NoHostError)) throw e;
    write("Not signed in to anything.\n");
    return 0;
  }
  const entry = store.hosts[base];
  if (!entry) {
    write(`Not signed in to ${base}.\n`);
    return 0;
  }
  try {
    await revokeSession(base, entry.token);
  } catch (e) {
    log.error(e instanceof AuthHttpError
      ? `Couldn't sign out of ${base}: it returned an error. Try again later.`
      : `Couldn't reach ${base} to sign out. Check your connection and try again.`, requestDetail(e));
    return 1;
  }
  const removed = await removeStoredSession(base, { expectedToken: entry.token, ...(filePath !== undefined ? { filePath } : {}) });
  write(removed ? `Signed out of ${base}.\n` : `Signed out of ${base}. Your newer sign-in is kept.\n`);
  return 0;
}

type AuthDeps = {
  env?: NodeJS.ProcessEnv;
  /** Folder whose `scout.config.json` may name the dashboard. */
  cwd?: string;
  store?: StoreOpt;
  interactive?: boolean;
  prompts?: PromptAdapter;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: Logger;
};

/**
 * Resolve a host for status/logout. Returns a concrete host only when the user
 * actively picks one from a select (interactive + several stored hosts + no
 * flag/env/default). Otherwise returns undefined, letting the callee resolve
 * (flag/env/default) and print its own "not signed in" message.
 */
async function selectHostIfAmbiguous(
  flagHost: string | undefined,
  configHost: string | undefined,
  env: NodeJS.ProcessEnv,
  deps: AuthDeps,
  interactive: boolean,
  prompts: PromptAdapter | undefined,
): Promise<string | undefined> {
  if (flagHost !== undefined) return flagHost;
  const store = await loadStore(deps.store?.filePath);
  try {
    resolveHost({ configHost, env, store });
    return undefined;
  } catch (e) {
    if (!(e instanceof NoHostError)) throw e;
    const hosts = Object.keys(store.hosts);
    if (interactive && prompts && hosts.length > 1) {
      const picked = assertNotCancelled(
        await prompts.select<string>({ message: "Which dashboard?", options: hosts.map((h) => ({ value: h, label: h })) }),
        prompts,
      );
      return normalizeHost(picked);
    }
    return undefined;
  }
}

export async function runAuth(argv: string[], deps: AuthDeps = {}): Promise<number> {
  const { positionals, values } = parseCommand("auth", argv);
  const sub = positionals[0];
  const { host } = values;
  const flagHost = typeof host === "string" ? host : undefined;
  const env = deps.env ?? process.env;
  const interactive = deps.interactive ?? false;
  const prompts = deps.prompts;
  const log = deps.log ?? new Logger();

  try {
    let configHost: string | undefined;
    if (sub === "login" || sub === "status" || sub === "logout") {
      try {
        configHost = (await loadConfig(resolve(deps.cwd ?? process.cwd(), "scout.config.json"))).host;
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        if (e.code === "CONFIG_INVALID") {
          log.error(e.message, e.detail);
          return 2;
        }
      }
    }
    switch (sub) {
      case "login": {
        const store = await loadStore(deps.store?.filePath);
        let resolved: string;
        try {
          resolved = resolveHost({ flagHost, configHost, env, store });
        } catch (e) {
          if (!(e instanceof NoHostError)) throw e;
          if (interactive && prompts) {
            const entered = assertNotCancelled(
              await prompts.text({ message: "Dashboard address", placeholder: "https://scout.example.com", validate: isValidUrl }),
              prompts,
            );
            resolved = normalizeHost(entered);
          } else {
            log.error("Couldn't sign in: no dashboard address is set. Run scout auth login --host <url>, or set SCOUTUI_HOST.");
            return 2;
          }
        }
        return runAuthLogin({
          host: resolved,
          ...(deps.store ? { store: deps.store } : {}),
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
          ...(deps.now ? { now: deps.now } : {}),
          log,
        });
      }
      case "status": {
        const picked = await selectHostIfAmbiguous(flagHost, configHost, env, deps, interactive, prompts);
        return runAuthStatus({ ...(picked !== undefined ? { host: picked } : {}), configHost, ...(deps.store ? { store: deps.store } : {}), env, log });
      }
      case "logout": {
        const picked = await selectHostIfAmbiguous(flagHost, configHost, env, deps, interactive, prompts);
        return runAuthLogout({ ...(picked !== undefined ? { host: picked } : {}), configHost, ...(deps.store ? { store: deps.store } : {}), env, log });
      }
      default:
        log.error(sub === undefined
          ? "Choose an auth command: scout auth login, logout or status."
          : `Unknown auth command '${sub}'. Use scout auth login, logout or status.`);
        return 2;
    }
  } catch (e) {
    if (e instanceof PromptCancelledError) {
      process.stderr.write("Cancelled.\n");
      return 130;
    }
    if (e instanceof InvalidHostError) {
      log.error(e.message);
      return 2;
    }
    throw e;
  }
}
