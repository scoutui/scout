import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runInit } from "../../../src/commands/init.js";
import { PromptCancelledError, type PromptAdapter } from "../../../src/prompts/adapter.js";
import { Logger } from "../../../src/util/log.js";
import { createColor, wordmark } from "../../../src/util/style.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";
import { stageFixture } from "../../helpers/stage-fixture.js";

const CANCEL = Symbol("cancel");

function stubAdapter(over: Partial<PromptAdapter> = {}): PromptAdapter {
  return {
    intro: () => {},
    outro: () => {},
    text: async (o) => o.initialValue ?? "",
    confirm: async () => false,
    select: async (o) => o.options[0]!.value,
    multiselect: async () => [],
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
    await runInit({ cwd: tmp, interactive: true, prompts: stubAdapter() });
    const prompted = written();
    rmSync(configPath());
    await runInit({ cwd: tmp });
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
    const prompts = stubAdapter({ text: async (o) => (o.message === "Dashboard address (optional)" ? CANCEL : (o.initialValue ?? "")) });
    await expect(runInit({ cwd: tmp, interactive: true, prompts })).rejects.toThrow(PromptCancelledError);
  });

  it("refuses a config that's already there before asking anything", async () => {
    const root = await stageWholeRepo({ files: { "scout.config.json": existingConfig } });
    const asked: string[] = [];
    const prompts = stubAdapter({
      intro: () => {
        asked.push("intro");
      },
      confirm: async (o) => {
        asked.push(o.message);
        return true;
      },
      text: async (o) => {
        asked.push(o.message);
        return o.initialValue ?? "";
      },
    });
    await expect(runInit({ cwd: root, interactive: true, prompts })).rejects.toMatchObject({
      message: `${join(root, "scout.config.json")} already exists. Edit it, or delete it and run scout init again.`,
      exitCode: 1,
    });
    expect(asked).toEqual([]);
    expect(readFileSync(join(root, "scout.config.json"), "utf8")).toBe(existingConfig);
  });
});

const existingConfig = '{ "repoId": "acme/kept" }\n';
const stages: string[] = [];
afterEach(() => {
  for (const dir of stages.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Stages whole-repo-scope without its config, deleting `remove` and writing `files` over it. */
async function stageWholeRepo(over: { remove?: string[]; files?: Record<string, string> } = {}): Promise<string> {
  const dir = await stageFixture("whole-repo-scope");
  stages.push(dir);
  for (const rel of ["scout.config.json", ...(over.remove ?? [])]) rmSync(join(dir, rel), { recursive: true });
  for (const [rel, content] of Object.entries(over.files ?? {})) writeFileSync(join(dir, rel), content);
  return dir;
}

describe("init wizard: what to leave out of the scan", () => {
  type Picker = Parameters<PromptAdapter["multiselect"]>[0];

  /** Runs the wizard in `dir`, ticking the offered options in `ticked`; returns each picker call and the `exclude` written. */
  async function pick(dir: string, ticked: string[] = [], given: { exclude?: string[] } = {}) {
    const asked: Picker[] = [];
    const prompts = stubAdapter({
      multiselect: async (o) => {
        asked.push(o);
        return o.options.filter((option) => ticked.includes(String(option.value))).map((option) => option.value);
      },
    });
    await runInit({ cwd: dir, interactive: true, prompts, ...given });
    const { exclude } = JSON.parse(readFileSync(join(dir, "scout.config.json"), "utf8"));
    return { asked, exclude };
  }

  const withRootPackage = (pkg: object) => ({ files: { "package.json": JSON.stringify({ name: "whole-repo-scope", private: true, ...pkg }) } });

  it("lists each package by name, then each top-level folder outside them, sorted by folder, as a checklist", async () => {
    const { asked } = await pick(await stageWholeRepo());
    expect(asked).toEqual([
      {
        message: "Leave any packages or folders out of the scan?",
        options: [
          { value: "apps/playground", label: "@example/playground", hint: "apps/playground" },
          { value: "apps/web", label: "@example/web", hint: "apps/web" },
          { value: "packages/shared-ui", label: "@example/shared-ui", hint: "packages/shared-ui" },
          { value: "scripts", label: "scripts" },
        ],
        required: false,
        maxItems: 10,
      },
    ]);
  });

  it.each([
    [[], []],
    [
      ["apps/playground", "scripts"],
      ["apps/playground", "scripts"],
    ],
  ])("writes the ticked folders %j to exclude", async (ticked, exclude) => {
    expect((await pick(await stageWholeRepo(), ticked)).exclude).toEqual(exclude);
  });

  it("asks only about packages when no top-level folder outside them holds a file the scan reads", async () => {
    const { asked } = await pick(await stageWholeRepo({ remove: ["scripts"] }));
    expect(asked.map((call) => [call.message, call.options.map((option) => option.value)])).toEqual([
      ["Leave any packages out of the scan?", ["apps/playground", "apps/web", "packages/shared-ui"]],
    ]);
  });

  it("doesn't offer the config's own folder when the workspaces list it", async () => {
    const { asked } = await pick(await stageWholeRepo(withRootPackage({ workspaces: [".", "apps/*", "packages/*"] })));
    expect(asked.map((call) => call.options.map((option) => option.value))).toEqual([
      ["apps/playground", "apps/web", "packages/shared-ui", "scripts"],
    ]);
  });

  it("doesn't ask without workspaces, even with top-level folders", async () => {
    const { asked, exclude } = await pick(await stageWholeRepo(withRootPackage({})));
    expect(asked).toEqual([]);
    expect(exclude).toEqual([]);
  });

  it("writes --exclude as given, without asking", async () => {
    const { asked, exclude } = await pick(await stageWholeRepo(), [], { exclude: ["apps/playground"] });
    expect(asked).toEqual([]);
    expect(exclude).toEqual(["apps/playground"]);
  });
});

describe("init wizard: run inside a workspace package", () => {
  const rootQuestion = { message: "Scan the whole repository instead of only this package?", initialValue: true };
  const color = createColor({ isTTY: true, env: {} });

  /** Runs the wizard from `cwd`, answering the root question with `whole`; returns the title, each root question, the picker's option values and the closing line. */
  async function runFrom(cwd: string, whole: boolean | symbol, given: { outputPath?: string } = {}) {
    const intros: string[] = [];
    const confirms: Parameters<PromptAdapter["confirm"]>[0][] = [];
    const pickers: string[][] = [];
    const outros: string[] = [];
    const prompts = stubAdapter({
      intro: (message) => {
        intros.push(message);
      },
      confirm: async (o) => {
        confirms.push(o);
        return whole;
      },
      multiselect: async (o) => {
        pickers.push(o.options.map((option) => String(option.value)));
        return [];
      },
      outro: (message) => {
        outros.push(message);
      },
    });
    await runInit({ cwd, interactive: true, prompts, log: new Logger({ color }), ...given });
    return { intros, confirms, pickers, outros };
  }

  it("writes the config at the repository root on Yes, named after the root's folder, and asks what to leave out there", async () => {
    const root = await stageWholeRepo();
    const { intros, confirms, pickers, outros } = await runFrom(join(root, "apps/web"), true);
    expect(intros).toEqual([wordmark(color, "init")]);
    expect(confirms).toEqual([rootQuestion]);
    expect(pickers).toEqual([["apps/playground", "apps/web", "packages/shared-ui", "scripts"]]);
    expect(outros).toEqual(["Wrote ../../scout.config.json. Run scout scan --dry-run in ../.. to try it, then scout scan to upload."]);
    expect(JSON.parse(readFileSync(join(root, "scout.config.json"), "utf8")).repoId).toBe(basename(root));
    expect(existsSync(join(root, "apps/web/scout.config.json"))).toBe(false);
  });

  it("writes the config in the package on No, without asking what to leave out", async () => {
    const root = await stageWholeRepo();
    const { confirms, pickers, outros } = await runFrom(join(root, "apps/web"), false);
    expect(confirms).toEqual([rootQuestion]);
    expect(pickers).toEqual([]);
    expect(outros).toEqual(["Wrote scout.config.json. Run scout scan --dry-run to try it, then scout scan to upload."]);
    expect(existsSync(join(root, "apps/web/scout.config.json"))).toBe(true);
    expect(existsSync(join(root, "scout.config.json"))).toBe(false);
  });

  it("refuses to write over a config already in the package on No", async () => {
    const root = await stageWholeRepo({ files: { "apps/web/scout.config.json": existingConfig } });
    await expect(runFrom(join(root, "apps/web"), false)).rejects.toMatchObject({
      message: `${join(root, "apps/web/scout.config.json")} already exists. Edit it, or delete it and run scout init again.`,
      exitCode: 1,
    });
    expect(readFileSync(join(root, "apps/web/scout.config.json"), "utf8")).toBe(existingConfig);
    expect(existsSync(join(root, "scout.config.json"))).toBe(false);
  });

  it("writes nothing when the root question is cancelled", async () => {
    const root = await stageWholeRepo();
    await expect(runFrom(join(root, "apps/web"), CANCEL)).rejects.toThrow(PromptCancelledError);
    expect(existsSync(join(root, "scout.config.json"))).toBe(false);
    expect(existsSync(join(root, "apps/web/scout.config.json"))).toBe(false);
  });

  it("doesn't ask about the repository root when run from it", async () => {
    const root = await stageWholeRepo();
    expect((await runFrom(root, true)).confirms).toEqual([]);
  });

  it("doesn't ask about the repository root when it already has a config", async () => {
    const root = await stageWholeRepo({ files: { "scout.config.json": existingConfig } });
    expect((await runFrom(join(root, "apps/web"), true)).confirms).toEqual([]);
    expect(existsSync(join(root, "apps/web/scout.config.json"))).toBe(true);
    expect(readFileSync(join(root, "scout.config.json"), "utf8")).toBe(existingConfig);
  });

  it("doesn't ask about the repository root when --output is given", async () => {
    const root = await stageWholeRepo();
    const { confirms } = await runFrom(join(root, "apps/web"), true, { outputPath: join(root, "apps/web/scout.config.json") });
    expect(confirms).toEqual([]);
  });
});
