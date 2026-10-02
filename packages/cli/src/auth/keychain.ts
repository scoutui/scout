import { spawn } from "node:child_process";

/** An OS credential store holding one session token per normalized host. */
export type Keychain = {
  /** The stored token, or undefined when there is none or the store can't be reached. */
  get(host: string): Promise<string | undefined>;
  /** Store the token; false when the store can't be reached or the host or token can't be passed to the tool safely. */
  set(host: string, token: string): Promise<boolean>;
  /** Remove the token; a missing entry or unreachable store is ignored. */
  delete(host: string): Promise<void>;
};

export type RunResult = { ok: boolean; stdout: string };
export type Run = (command: string, args: string[], input?: string) => Promise<RunResult>;

const SERVICE = "scoutui";
const SECURITY = "/usr/bin/security";
const TIMEOUT_MS = 30_000;
/** The per-command read limit of `security -i`, newline included; anything longer runs as a further command. */
const SECURITY_LINE_MAX = 4095;

/** Run a tool with `input` on stdin; a spawn failure, non-zero exit or timeout is `ok: false`. Stderr is discarded. */
function run(command: string, args: string[], input = ""): Promise<RunResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"], timeout: TIMEOUT_MS });
      child.on("error", () => resolve({ ok: false, stdout: "" }));
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.on("close", (code) => resolve({ ok: code === 0, stdout }));
      child.stdout.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    } catch {
      resolve({ ok: false, stdout: "" });
    }
  });
}

function tokenFrom({ ok, stdout }: RunResult): string | undefined {
  const token = stdout.replace(/\n$/, "");
  return ok && token !== "" ? token : undefined;
}

/** macOS login Keychain through `security`; writes go through `security -i` so the token travels on stdin. */
function macosKeychain(exec: Run): Keychain {
  return {
    async get(host) {
      return tokenFrom(await exec(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", host, "-w"]));
    },
    async set(host, token) {
      if (!/^[\x20-\x7e]+$/.test(host) || /["\\]/.test(host)) return false;
      const hex = Buffer.from(token, "utf8").toString("hex");
      const line = `add-generic-password -U -s ${SERVICE} -a "${host}" -X ${hex}\n`;
      if (line.length > SECURITY_LINE_MAX) return false;
      return (await exec(SECURITY, ["-i"], line)).ok;
    },
    async delete(host) {
      await exec(SECURITY, ["delete-generic-password", "-s", SERVICE, "-a", host]);
    },
  };
}

/** Linux Secret Service through `secret-tool`, which reads the secret from stdin. */
function secretService(exec: Run): Keychain {
  const attributes = (host: string) => ["service", SERVICE, "host", host];
  return {
    async get(host) {
      return tokenFrom(await exec("secret-tool", ["lookup", ...attributes(host)]));
    },
    async set(host, token) {
      return (await exec("secret-tool", ["store", "--label", `${SERVICE} ${host}`, ...attributes(host)], token)).ok;
    },
    async delete(host) {
      await exec("secret-tool", ["clear", ...attributes(host)]);
    },
  };
}

const noKeychain: Keychain = {
  get: async () => undefined,
  set: async () => false,
  delete: async () => {},
};

/** The platform's credential store: macOS Keychain, Linux Secret Service, none elsewhere. */
export function systemKeychain(platform: NodeJS.Platform = process.platform, exec: Run = run): Keychain {
  if (platform === "darwin") return macosKeychain(exec);
  if (platform === "linux") return secretService(exec);
  return noKeychain;
}
