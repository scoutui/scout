import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTarget } from "./run-in-repo.js";
import { TARGETS } from "./targets.js";
import type { Step } from "./types.js";

export interface Args {
  target?: string;
  step?: string;
  workDir?: string;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

/** Parse `[--target name] [--step prepare|scan] [--work-dir dir]`. */
export function parseArgs(argv: string[]): Args {
  const target = flagValue(argv, "--target");
  const step = flagValue(argv, "--step");
  const workDir = flagValue(argv, "--work-dir");
  return {
    ...(target !== undefined ? { target } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(workDir !== undefined ? { workDir } : {}),
  };
}

function isStep(value: string): value is Step {
  return value === "prepare" || value === "scan";
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliBin = join(repoRoot, "packages", "cli", "dist", "cli.js");

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { target, step, workDir } = parseArgs(argv);
  // Guard a flag with no value: otherwise a bare `--target` falls through to
  // "run all" and reports a misleading pass against the whole matrix.
  for (const [flag, value] of [["--target", target], ["--step", step], ["--work-dir", workDir]] as const) {
    if (argv.includes(flag) && value === undefined) {
      process.stderr.write(`${flag} requires a value\n`);
      return 1;
    }
  }
  if (step !== undefined && !isStep(step)) {
    process.stderr.write(`--step must be prepare or scan, not ${step}\n`);
    return 1;
  }
  if (step !== undefined && workDir === undefined) {
    process.stderr.write("--step requires --work-dir, so the scan step can find what the prepare step installed\n");
    return 1;
  }
  const targets = target !== undefined ? TARGETS.filter((t) => t.name === target) : TARGETS;
  if (targets.length === 0) {
    process.stderr.write(`no target named ${String(target)}\n`);
    return 1;
  }

  const allFailures: string[] = [];
  for (const t of targets) {
    process.stdout.write(`\n=== ${t.name} (${t.repo})${step !== undefined ? `: ${step}` : ""} ===\n`);
    // Each target gets its own directory under --work-dir, kept after the run.
    const results = await runTarget(t, cliBin, {
      ...(workDir !== undefined ? { workDir: resolve(workDir, t.name) } : {}),
      ...(step !== undefined && isStep(step) ? { step } : {}),
    });
    for (const r of results) {
      if (r.failures.length === 0) {
        process.stdout.write(`  ok ${r.repoId}\n`);
      } else {
        for (const f of r.failures) {
          process.stderr.write(`  FAIL ${f}\n`);
          allFailures.push(f);
        }
      }
    }
  }

  if (allFailures.length > 0) {
    process.stderr.write(`\n${allFailures.length} failure(s).\n`);
    return 1;
  }
  process.stdout.write(step === "prepare" ? "\nAll targets cloned and installed.\n" : "\nAll scans passed.\n");
  return 0;
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    },
  );
}
