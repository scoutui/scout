import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runInit } from "../../../src/commands/init.js";
import { walkFiles } from "../../../src/walker/files.js";
import { PromptCancelledError, type PromptAdapter } from "../../../src/prompts/adapter.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";

const CANCEL = Symbol("cancel");

function stubAdapter(over: Partial<PromptAdapter> = {}): PromptAdapter {
  return {
    intro: () => {},
    outro: () => {},
    text: async (o) => o.initialValue ?? "",
    confirm: async () => false,
    select: async (o) => o.options[0]!.value,
    multiselect: async (o) => o.options.filter((option) => String(option.value) === "react").map((option) => option.value),
    isCancel: (v): v is symbol => v === CANCEL,
    ...over,
  };
}

describe("init wizard", () => {
  let tmp: string;
  let ssh: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-initw-"));
    ssh = fakeSsh();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
    rmSync(ssh, { recursive: true, force: true });
  });

  const configPath = () => join(tmp, "scout.config.json");
  const written = () => JSON.parse(readFileSync(configPath(), "utf8"));

  function cloneOfCheckout(): void {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { cwd: tmp, stdio: "pipe" });
    git("init", "-q", "--initial-branch=main");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("remote", "add", "origin", "git@github.com:acme/checkout.git");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }

  it("writes the same config as --yes when every suggestion is accepted", async () => {
    cloneOfCheckout();
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "demo", dependencies: { react: "18" } }));
    await runInit({ cwd: tmp, interactive: true, prompts: stubAdapter() });
    const prompted = written();
    rmSync(configPath());
    await runInit({ cwd: tmp, frameworks: ["react"] });
    expect(prompted).toEqual(written());
    expect(prompted.repoId).toBe("acme/checkout");
  });

  it("saves the typed dashboard address, repository name and branch", async () => {
    cloneOfCheckout();
    const answers: Record<string, string> = {
      "Dashboard address (optional)": "scout.example.com",
      "Repository name on the dashboard": "acme/storefront",
      "Branch the dashboard tracks": "release",
    };
    await runInit({ cwd: tmp, interactive: true, prompts: stubAdapter({ text: async (o) => answers[o.message] ?? "" }) });
    expect(written()).toMatchObject({ repoId: "acme/storefront", host: "https://scout.example.com", branch: "release" });
  });

  it("asks which remote the dashboard follows when several leave it unclear, and saves the answer in the checkout", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "pipe" }).toString().trim();
    git("init", "-q");
    git("remote", "add", "github", "git@github.com:acme/mirror.git");
    git("remote", "add", "gitlab", "git@gitlab.com:acme/checkout.git");
    git("symbolic-ref", "refs/remotes/gitlab/HEAD", "refs/remotes/gitlab/main");
    const asked: { message: string; options: string[] }[] = [];
    const prompts = stubAdapter({
      select: async (o) => {
        asked.push({ message: o.message, options: o.options.map((option) => String(option.value)) });
        return o.options.find((option) => String(option.value) === "gitlab")?.value ?? CANCEL;
      },
    });
    await runInit({ cwd: tmp, interactive: true, prompts });
    expect(asked).toEqual([{ message: "Which remote does the dashboard follow?", options: ["github", "gitlab"] }]);
    expect(git("config", "--get", "scout.remote")).toBe("gitlab");
    expect(written().repoId).toBe("acme/checkout");
  });

  it("checks each answer as it's typed", async () => {
    const checks: Record<string, (value: string | undefined) => string | Error | undefined> = {};
    const prompts = stubAdapter({
      text: async (o) => {
        if (o.validate) checks[o.message] = o.validate;
        return o.initialValue ?? "";
      },
    });
    await runInit({ cwd: tmp, interactive: true, prompts });
    expect(checks["Dashboard address (optional)"]?.("")).toBeUndefined();
    expect(checks["Dashboard address (optional)"]?.("http://scout.example.com")).toBe(
      "http://scout.example.com doesn't use https://, so your sign-in would be sent unencrypted. Use the dashboard's https:// address. Plain http:// works only for localhost.",
    );
    expect(checks["Repository name on the dashboard"]?.(" ")).toBe("Enter a repository name.");
    expect(checks["Branch the dashboard tracks"]?.("")).toBe("Enter a branch name.");
  });

  it("maps a cancelled prompt to PromptCancelledError", async () => {
    const prompts = stubAdapter({ multiselect: async () => CANCEL });
    await expect(runInit({ cwd: tmp, interactive: true, prompts })).rejects.toThrow(PromptCancelledError);
  });

  it("non-interactive config includes all supported source extensions", async () => {
    await runInit({ cwd: tmp });
    const cfg = JSON.parse(readFileSync(join(tmp, "scout.config.json"), "utf8"));
    expect(cfg.include).toEqual(["src/**/*.{ts,tsx,jsx,js,vue}"]);
  });

  it("offers only React and Vue, and picking Vue writes an include that finds .vue and .ts files", async () => {
    let offered: string[] = [];
    const prompts = stubAdapter({
      multiselect: async (o) => {
        offered = o.options.map((option) => String(option.value));
        return o.options.filter((option) => String(option.value) === "vue").map((option) => option.value);
      },
    });
    await runInit({ cwd: tmp, interactive: true, prompts });
    expect(offered).toEqual(["react", "vue"]);
    const cfg = JSON.parse(readFileSync(join(tmp, "scout.config.json"), "utf8"));
    mkdirSync(join(tmp, "src", "components"), { recursive: true });
    writeFileSync(join(tmp, "src", "components", "Button.vue"), "<template><button /></template>\n");
    writeFileSync(join(tmp, "src", "components", "index.ts"), 'export { default as Button } from "./Button.vue";\n');
    const files = await walkFiles({ root: tmp, include: cfg.include, exclude: cfg.exclude, gitignore: false });
    expect(files).toEqual([join(tmp, "src", "components", "Button.vue"), join(tmp, "src", "components", "index.ts")]);
  });
});
