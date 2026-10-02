import { mkdir, readFile, writeFile, chmod, rename, unlink, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { systemKeychain, type Keychain } from "./keychain.js";
import { hostsFilePath } from "./paths.js";
import { CliError } from "../cli/parse.js";

export type HostEntry = {
  token: string;
  userEmail: string;
};

export type Store = {
  /** Normalized base URL of the default host, if any. */
  default?: string | undefined;
  hosts: Record<string, HostEntry>;
};

/** A hosts.json entry; `token` is present only when the keychain couldn't hold it. */
type FileEntry = { token?: string; userEmail: string };
type FileStore = { default?: string; hosts: Record<string, FileEntry> };

/** A host URL the CLI won't connect to: malformed, or one that would send a token unencrypted. */
export class InvalidHostError extends Error {}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Canonical base URL: prepend https:// when no scheme, strip trailing slashes.
 * Only https:// is accepted, apart from http:// on this computer (localhost, 127.0.0.1, ::1).
 */
export function normalizeHost(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") throw new InvalidHostError("Host must not be empty.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidHostError(`${trimmed} isn't a valid host URL. Use the dashboard's address, for example https://scout.example.com.`);
  }
  const allowed = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname));
  if (!allowed) {
    throw new InvalidHostError(
      `${trimmed} doesn't use https://, so your sign-in would be sent unencrypted. Use the dashboard's https:// address. Plain http:// works only for localhost.`,
    );
  }
  return withScheme.replace(/\/+$/, "");
}

/** A prompt's check on a dashboard address: why it can't be used, or undefined when it can. */
export function isValidUrl(value: string | undefined): string | undefined {
  if (!value) return "Enter a valid host URL.";
  try {
    normalizeHost(value);
    return undefined;
  } catch (e) {
    return e instanceof InvalidHostError ? e.message : "Enter a valid host URL.";
  }
}

async function readFileStore(filePath: string): Promise<FileStore> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { hosts: {} };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new CliError(`Your saved sessions in ${filePath} can't be read. Delete the file and run scout auth login to sign in again.`, 1, { cause: err });
  }
  const value = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as { default?: unknown; hosts?: unknown }
    : {};
  const entries = typeof value.hosts === "object" && value.hosts !== null && !Array.isArray(value.hosts)
    ? Object.entries(value.hosts)
    : [];
  const hosts = Object.fromEntries(entries.flatMap(([host, entry]) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const candidate = entry as { token?: unknown; userEmail?: unknown };
    if (typeof candidate.userEmail !== "string") return [];
    if (candidate.token === undefined) return [[host, { userEmail: candidate.userEmail }]];
    return typeof candidate.token === "string" ? [[host, { token: candidate.token, userEmail: candidate.userEmail }]] : [];
  })) as Record<string, FileEntry>;
  return { ...(typeof value.default === "string" && value.default ? { default: value.default } : {}), hosts };
}

/** Resolve each host's token: the inline one, else the keychain's; hosts with neither are left out. */
async function resolveTokens(file: FileStore, keychain: Keychain): Promise<Store> {
  const hosts: Record<string, HostEntry> = {};
  for (const [host, entry] of Object.entries(file.hosts)) {
    const token = entry.token ?? await keychain.get(host);
    if (token !== undefined) hosts[host] = { token, userEmail: entry.userEmail };
  }
  return { ...(file.default ? { default: file.default } : {}), hosts };
}

export async function loadStore(filePath = hostsFilePath(), keychain = systemKeychain()): Promise<Store> {
  return await resolveTokens(await readFileStore(filePath), keychain);
}

export type TokenStorage = "keychain" | "hosts.json";

/** Where a host's session token lives: inline in hosts.json, or in the keychain. Undefined when the host has no entry. */
export async function tokenStorage(host: string, filePath = hostsFilePath()): Promise<TokenStorage | undefined> {
  const { hosts } = await readFileStore(filePath);
  const base = normalizeHost(host);
  if (!Object.hasOwn(hosts, base)) return undefined;
  return hosts[base]?.token === undefined ? "keychain" : "hosts.json";
}

async function writeFileStore(store: FileStore, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 25;

export class StoreLockError extends Error {}

async function releaseStoreLock(lockPath: string, owner: string): Promise<void> {
  try {
    if (await readFile(lockPath, "utf8") === owner) await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function withStoreLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const owner = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    if (Date.now() >= deadline) {
      throw new StoreLockError(`Timed out waiting for credential store lock at ${lockPath}. Retry, or remove it only after confirming no CLI process is running.`);
    }
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(owner);
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(LOCK_POLL_MS);
    }
  }
  try {
    return await action();
  } finally {
    await releaseStoreLock(lockPath, owner);
  }
}

/**
 * Write `next` over `before`: an unchanged token stays where it is, a new token goes to the
 * keychain (inline when it can't be stored), removed hosts lose their keychain entry after the
 * file is written, and hosts whose token couldn't be read are kept as they were.
 */
async function persist(file: FileStore, before: Store, next: Store, filePath: string, keychain: Keychain): Promise<void> {
  const hosts: Record<string, FileEntry> = {};
  for (const [host, entry] of Object.entries(file.hosts)) {
    if (!Object.hasOwn(before.hosts, host) && !Object.hasOwn(next.hosts, host)) hosts[host] = entry;
  }
  for (const [host, { token, userEmail }] of Object.entries(next.hosts)) {
    const inline = before.hosts[host]?.token === token
      ? file.hosts[host]?.token !== undefined
      : !(await keychain.set(host, token));
    hosts[host] = inline ? { token, userEmail } : { userEmail };
  }
  await writeFileStore({ ...(next.default ? { default: next.default } : {}), hosts }, filePath);
  for (const host of Object.keys(before.hosts)) {
    if (!Object.hasOwn(next.hosts, host)) await keychain.delete(host);
  }
}

/** Replace every readable session with the caller's complete snapshot. */
export async function saveStore(store: Store, filePath = hostsFilePath(), keychain = systemKeychain()): Promise<void> {
  await mutateStore((current) => {
    current.default = store.default;
    current.hosts = store.hosts;
    return { changed: true, result: undefined };
  }, filePath, keychain);
}

/** Serialize a read-modify-write mutation across CLI processes using the store's lock file. */
export async function mutateStore<T>(
  change: (store: Store) => { changed: boolean; result: T },
  filePath = hostsFilePath(),
  keychain = systemKeychain(),
): Promise<T> {
  return await withStoreLock(filePath, async () => {
    const file = await readFileStore(filePath);
    const before = await resolveTokens(file, keychain);
    const store = structuredClone(before);
    const { changed, result } = change(store);
    if (changed) await persist(file, before, store, filePath, keychain);
    return result;
  });
}
