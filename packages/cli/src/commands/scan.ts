import { performance } from "node:perf_hooks";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import { statSync } from "node:fs";
import { loadConfig, ConfigError } from "../config/loader.js";
import { createLazyResolver } from "../barrels/lazy-resolver.js";
import { buildLocalIndex } from "../local-index/index.js";
import { extractReactDeclaredProps } from "../local-index/declared-props.js";
import { detectVueComponents } from "../local-index/detect-vue.js";
import { detectWebComponents } from "../local-index/detect-wc.js";
import type { LocalDefinition } from "../local-index/types.js";
import { parseByExt, syntaxErrorWarning, type ParsedFile } from "../parse-by-ext.js";
import { createProgress, startPhase } from "../util/progress.js";
import { walkFiles } from "../walker/files.js";
import { createImportResolver } from "../walker/resolve-import.js";
import { resolveTsconfigPath } from "../walker/tsconfig-discovery.js";
import { buildPackageAliasLayers } from "../walker/package-alias-layers.js";
import { emitReact } from "@scoutui/parser-react";
import { emitVueTemplate } from "@scoutui/parser-vue";
import { writeJson } from "../reporter/json.js";
import { printSummary } from "../reporter/stdout.js";
import { readCheckout, readCliPackage, stampMeta, type StampedMeta } from "../scan/meta.js";
import { checkGitState, uncommittedRefusal, type TrackedBranch } from "../upload-policy/git-state.js";
import { installedVersionReader } from "../scan/stamp-version.js";
import { buildCemIndex } from "../scan/cem-index.js";
import { isPnpProject } from "../util/pnp-check.js";
import { readGitToplevel } from "../util/git.js";
import { findWorkspaceRoot } from "../workspace/find-workspace-root.js";
import { Logger } from "../util/log.js";
import { describeUploadError, UploadRefusedError, uploadPending } from "../upload.js";
import type { AuthedUploader } from "../auth/upload-auth.js";
import { errorMessage, errorStack } from "../util/errors.js";
import { CliError } from "../cli/parse.js";
import {
  createGraphBuilder,
  denoteName,
  posixPath,
  resolve as resolveGraph,
  type EngineOccurrence,
  type OccurrenceVia,
  type ResolveOpts,
} from "@scoutui/reference-graph";
import { buildComponentSeeds, seedFor, type RosterRegistry } from "../seeds.js";
import { emitArtifact } from "../artifact/emit.js";
import { emptyScanRefusal, setupRefusal } from "../upload-policy/index.js";
import { preScanRequest, preScanUrl } from "../upload-policy/dashboard.js";
import { scanIdOf, toIdentity } from "../artifact/identity.js";
import { tagEvidenceSources, type TargetResolver } from "../artifact/tag-evidence.js";
import { diagnosticLogLines, formatWarning } from "../reporter/diagnostic-lines.js";
import {
  buildWorkspaceGraph,
  createDeclaredDependencyTest,
  isFirstPartyPath,
  resetFindOwningPackageCache,
  type WorkspaceGraph,
} from "../workspace/index.js";
import { createBoundedDefinitionResolver } from "../walker/bounded-definition-resolver.js";
import { isInstalledPackage } from "../walker/installed-package.js";
import { loadGlobalComponents, detectAutoImportFramework } from "../scan/global-components.js";
import { type DiagnosticCollector, createDiagnosticCollector } from "../diagnostic.js";
import { buildScanStats, type ScanStats } from "../artifact/scan-stats.js";
import { validateArtifact, type AttributionTarget, type DeclaredPropApi, type ScanArtifact } from "@scoutui/scan-format";
import type { ResolvedConfig } from "../types.js";

export type ScanOptions = {
  /**
   * Path to the config file. Defaults to `<cwd>/scout.config.json`
   * when `cwd` is provided and `configPath` is omitted.
   */
  configPath?: string;
  /**
   * Working directory used to locate the config when `configPath` is omitted.
   * Has no effect when `configPath` is supplied.
   */
  cwd?: string;
  quiet?: boolean;
  /** The command's logger; its `quiet` wins over `quiet` above. */
  log?: Logger;
  repoId?: string;
  /**
   * Directory to treat as the repository root for artefact paths, instead of
   * the git toplevel. Resolved against `cwd` when relative.
   */
  repoRoot?: string;
  /** Upload the scan. Without it, the scan is a dry run: it writes scout-scan.json next to the config and contacts no dashboard. */
  upload?: boolean;
  /** Upload even if the dashboard already has this commit, replacing its scan. Needs `upload`. */
  rescan?: boolean;
  hostOverride?: string;
};

export type UploadOutcome = "ok" | "exists" | "skipped" | "failed";

export type ScanResult = { output: ScanArtifact | null; upload: UploadOutcome };

/**
 * Map a scan result to a process exit code: 1 = requested upload failed,
 * including a refusal before scanning; 2 = scan failed; 0 = ok, including a
 * commit the dashboard already has, skipped before scanning.
 */
export function scanExitCode(result: ScanResult): number {
  if (result.upload === "failed") return 1;
  if (result.output === null && result.upload !== "exists") return 2;
  return 0;
}

/** The line for a commit the dashboard already has a scan of, linking to it. */
function alreadyOnDashboard(commit: string, url: string): string {
  return `Commit ${commit.slice(0, 7)} is already on the dashboard: ${url}. Run scout scan --rescan to scan it again.`;
}

export async function runScan(opts: ScanOptions): Promise<ScanResult> {
  const log = opts.log ?? new Logger({ quiet: opts.quiet ?? false });
  const { quiet } = log;
  const t0 = performance.now();

  const configPath =
    opts.configPath ??
    resolve(opts.cwd ?? process.cwd(), "scout.config.json");

  const cfg = await loadScanConfig(configPath, log);
  if (cfg === null) return { output: null, upload: "skipped" };

  if (isPnpProject(cfg.configDir)) {
    log.error(
      "Scout can't read packages installed with Yarn Plug'n'Play. Set nodeLinker: node-modules in .yarnrc.yml, run yarn install, and scan again."
    );
    return { output: null, upload: "skipped" };
  }

  // Read git once, early: throws if the directory isn't a git work tree, or if
  // git can't give the HEAD commit's date.
  const checkout = await readCheckout(cfg.configDir, log);
  let tracked: TrackedBranch | undefined;
  if (opts.upload) {
    const state = await checkGitState(checkout, {
      cwd: cfg.configDir,
      ...(cfg.branch !== undefined ? { branch: cfg.branch } : {}),
    });
    if (state.kind === "refused") {
      log.error(state.message);
      return { output: null, upload: "failed" };
    }
    tracked = state.tracked;
  } else if (checkout.shallow) {
    log.warn("This checkout doesn't have the full history. Run git fetch --unshallow and scan again.");
  }
  const repoIdOverride = opts.repoId ?? cfg.repoId;
  const meta = stampMeta(checkout, {
    cwd: cfg.configDir,
    ...(repoIdOverride !== undefined ? { repoIdOverride } : {}),
    ...(tracked !== undefined ? { tracked } : {}),
  });

  const outputRoot = await scanOutputRoot(cfg.configDir, opts);

  if (opts.repoRoot && !statSync(outputRoot, { throwIfNoEntry: false })?.isDirectory()) {
    log.error(`Repository root ${outputRoot} is not a directory. Pass an existing directory to --repo-root.`);
    return { output: null, upload: "skipped" };
  }

  // Where a dry run writes the scan file.
  const outputPath = join(cfg.configDir, "scout-scan.json");
  if (!opts.upload && !(await writesInside(cfg.configDir, outputPath))) {
    log.error(
      `scout-scan.json in ${cfg.configDir} links to a file outside that folder, so the scan won't write it. Delete the link and try again.`,
    );
    return { output: null, upload: "skipped" };
  }

  const { workspaceRoot, workspaceGraph, files } = await readWorkspace(cfg, outputRoot, log);
  if (files.length === 0) {
    log.error(`No files match "include" in ${configPath} (${cfg.include.join(", ")}). Point it at your source files and scan again.`);
    return { output: null, upload: "skipped" };
  }

  if (opts.upload) {
    // An untracked config or scan output file doesn't count as an uncommitted change.
    const uncommitted = await uncommittedRefusal(cfg.configDir, { files, exempt: [cfg.configPath, outputPath] });
    if (uncommitted !== null) {
      log.error(uncommitted.message, uncommitted.detail);
      return { output: null, upload: "failed" };
    }
  }

  let uploader: AuthedUploader | undefined;
  if (opts.upload) {
    try {
      const { createAuthedUploader } = await import("../auth/upload-auth.js");
      let waiting = false;
      uploader = await createAuthedUploader({
        ...(opts.hostOverride !== undefined ? { flagHost: opts.hostOverride } : {}),
        ...(cfg.host !== undefined ? { configHost: cfg.host } : {}),
        onStatus: (status) => {
          if (uploadPending(status) && !waiting) {
            waiting = true;
            log.info("Waiting for the dashboard to process the scan…");
          }
        },
      });
      const [answer] = (await uploader.check(preScanRequest(meta, opts.rescan === true, [meta.repo.commit]), log)) ?? [];
      if (answer?.decision === "skip") {
        log.result(alreadyOnDashboard(meta.repo.commit, new URL(answer.url, uploader.base).href));
        return { output: null, upload: "exists" };
      }
      if (answer?.decision === "refuse") throw new UploadRefusedError(answer.message, answer.code, preScanUrl(uploader.base));
    } catch (err) {
      const { message, detail } = describeUploadError(err, uploader?.base);
      log.error(message, detail);
      return { output: null, upload: "failed" };
    }
  }

  const setupRefused = uploader ? setupRefusal(workspaceGraph, files, cfg.configDir) : null;
  if (setupRefused !== null) {
    log.error(setupRefused);
    return { output: null, upload: "failed" };
  }

  const { artifact, stats } = await scanRepository({ cfg, outputRoot, workspaceRoot, workspaceGraph, files, meta, log, startedAt: t0 });

  // A dry run writes the scan file; an upload doesn't.
  if (uploader === undefined) await writeJson(artifact, outputPath);

  if (!quiet) {
    printSummary(artifact, stats);
  }

  if (uploader === undefined) {
    log.result(`Wrote ${relative(await realpath(opts.cwd ?? process.cwd()), outputPath)} (not uploaded).`);
    return { output: artifact, upload: "skipped" };
  }

  let upload: UploadOutcome = "skipped";
  const refusal = emptyScanRefusal(stats, { configPath });
  if (refusal !== null) {
    upload = "failed";
    log.error(refusal);
  } else {
    try {
      const result = await uploader.upload(JSON.stringify(artifact), { rescan: opts.rescan === true });
      upload = result.status === "inserted" ? "ok" : "exists";
      const scanUrl = new URL(result.url, uploader.base).href;
      const commit = artifact.meta.repo.commit;
      log.result(
        result.status === "exists"
          ? alreadyOnDashboard(commit, scanUrl)
          : result.replaced
            ? `Uploaded the scan of ${commit.slice(0, 7)}, replacing the earlier one: ${scanUrl}`
            : `Uploaded the scan of ${commit.slice(0, 7)}: ${scanUrl}`,
      );
    } catch (err) {
      upload = "failed";
      const { message, detail } = describeUploadError(err, uploader.base);
      log.error(message, detail);
    }
  }

  return { output: artifact, upload };
}

/** The config at `configPath`, or null after printing why it can't be loaded. */
export async function loadScanConfig(configPath: string, log: Logger): Promise<ResolvedConfig | null> {
  try {
    return await loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      return null;
    }
    throw err;
  }
}

/** The directory the scan file's paths are relative to. */
export async function scanOutputRoot(configDir: string, opts: { repoRoot?: string; cwd?: string }): Promise<string> {
  // Root for artefact paths: `repoRoot` if given, else the git toplevel if it
  // contains configDir (otherwise every path would start with `..`), else configDir.
  const gitToplevel = await readGitToplevel(configDir);
  return opts.repoRoot
    ? (isAbsolute(opts.repoRoot)
        ? opts.repoRoot
        : resolve(opts.cwd ?? process.cwd(), opts.repoRoot))
    : (gitToplevel && !relative(gitToplevel, configDir).startsWith("..")
        ? gitToplevel
        : configDir);
}

/** The workspace root, its package graph and the files the config includes. */
export async function readWorkspace(
  cfg: ResolvedConfig,
  outputRoot: string,
  log: Logger,
): Promise<{ workspaceRoot: string; workspaceGraph: WorkspaceGraph; files: string[] }> {
  const writer = log.quiet ? () => {} : (s: string) => process.stderr.write(s);

  // The nearest workspace root above configDir (bounded by outputRoot), so a
  // scan of a monorepo subfolder resolves against the hoisted node_modules and tsconfig.
  const workspaceRoot = findWorkspaceRoot(cfg.configDir, outputRoot) ?? cfg.configDir;
  if (workspaceRoot !== cfg.configDir) {
    writer(`Monorepo root: ${posixPath(relative(cfg.configDir, workspaceRoot))}\n`);
  }

  // Clear caches from an earlier scan in the same process, in case the filesystem changed.
  resetFindOwningPackageCache();
  const workspaceGraph = buildWorkspaceGraph(workspaceRoot);

  const files = await walkFiles({
    root: cfg.configDir,
    include: cfg.include,
    exclude: cfg.exclude,
    gitignore: cfg.gitignore,
  });

  return { workspaceRoot, workspaceGraph, files };
}

/** The scan file built from the workspace's files, checked against its format, and its stats. */
export async function scanRepository(input: {
  cfg: ResolvedConfig;
  outputRoot: string;
  workspaceRoot: string;
  workspaceGraph: WorkspaceGraph;
  files: string[];
  meta: StampedMeta;
  log: Logger;
  /** performance.now() when the scan started. */
  startedAt: number;
}): Promise<{ artifact: ScanArtifact; stats: ScanStats }> {
  const { cfg, outputRoot, workspaceRoot, workspaceGraph, files, meta, log, startedAt } = input;
  const { quiet } = log;

  // Re-base a scanRoot-relative POSIX path into outputRoot-relative POSIX.
  const rebase = (scanRel: string): string =>
    outputRoot === cfg.configDir
      ? scanRel
      : posixPath(relative(outputRoot, resolve(cfg.configDir, scanRel)));

  const writer = quiet ? () => {} : (s: string) => process.stderr.write(s);
  // Warnings about how the scan reads the repo, each printed once, hidden by --quiet like progress.
  const warned = new Set<string>();
  const scanWarning = (msg: string) => {
    if (quiet || warned.has(msg)) return;
    warned.add(msg);
    log.warn(msg);
  };
  const reportSyntaxErrors = (path: string, messages: string[]) =>
    log.warn(syntaxErrorWarning(path, messages), messages.join("\n"));

  const resolveImportOpts: Parameters<typeof createImportResolver>[0] = {
    repoRoot: workspaceRoot,
    workspaceGraph,
    onWarning: (msg: string) => scanWarning(msg),
  };
  if (cfg.aliases) resolveImportOpts.aliases = cfg.aliases;
  const packageAliases = buildPackageAliasLayers(workspaceGraph, (msg) => scanWarning(msg));
  resolveImportOpts.packageAliasLayers = packageAliases.layers;
  const tsconfigPath = resolveTsconfigPath({
    configDir: cfg.configDir,
    repoRoot: workspaceRoot,
    ...(cfg.tsconfigPath !== undefined ? { tsconfigPath: cfg.tsconfigPath } : {}),
  });
  if (tsconfigPath) resolveImportOpts.tsconfigPath = tsconfigPath;
  const resolveImport = createImportResolver(resolveImportOpts);
  const collector = createDiagnosticCollector();
  const graphKeyCollector: DiagnosticCollector = {
    emit: (d) => collector.emit("filePath" in d ? { ...d, filePath: rebase(d.filePath) } : d),
    drain: collector.drain,
  };

  // Resolves an external import's leaf package and public entry.
  const lazyResolver = createLazyResolver({
    resolveImport,
    repoRoot: workspaceRoot,
    collector,
  });

  // Custom Elements Manifest index of every package installed in the repository.
  const cemIndex = await buildCemIndex({ root: outputRoot, configDir: cfg.configDir });


  const packageTsconfigs = packageAliases.tsconfigCount;
  if (tsconfigPath) {
    writer(`Path aliases: ${posixPath(relative(cfg.configDir, tsconfigPath))}\n`);
  } else if (packageTsconfigs > 0) {
    writer(packageTsconfigs === 1
      ? "Path aliases: a tsconfig file in 1 workspace package\n"
      : `Path aliases: tsconfig files in ${packageTsconfigs} workspace packages\n`);
  } else {
    writer('Path aliases: no tsconfig.json found. If yours has another name, set "tsconfigPath" in scout.config.json.\n');
  }
  const isTTY = !!process.stderr.isTTY;
  const { columns } = process.stderr;
  const parseProgress = createProgress({
    total: files.length,
    writer,
    isTTY,
    label: "Reading files",
    columns,
  });

  const localDefs: LocalDefinition[] = [];
  const declaredByFile = new Map<string, Map<string, DeclaredPropApi>>();

  // Filled during Phase 1, so the local index and the graph share one read and
  // parse per file.
  const graphBuilder = createGraphBuilder({ moduleResolver: resolveImport, repoRoot: cfg.configDir });

  // The generated GlobalComponents declaration (Nuxt and unplugin-vue-components
  // write one) lists globally available Vue components. Problems with it become
  // diagnostics, not failures.
  const autoImports = loadGlobalComponents(cfg.configDir);
  if (autoImports !== null) {
    for (const s of autoImports.stale) {
      collector.emit({
        code: "auto-import-stale-entry",
        severity: "warning",
        filePath: autoImports.declarationPath,
        componentName: s.componentName,
        // s.target is absolute; the artefact stores repo-relative POSIX paths
        // so it stays portable across machines.
        target: posixPath(relative(cfg.configDir, s.target)),
      });
    }
  } else {
    const framework = detectAutoImportFramework(cfg.configDir);
    if (framework !== null) {
      const missing = {
        code: "auto-import-manifest-missing",
        severity: "warning",
        filePath: framework.expectedPath,
        detail:
          "This Nuxt app hasn't been prepared, so auto-imported components aren't counted. Run npx nuxt prepare and scan again.",
      } as const;
      collector.emit(missing);
      // Surface at scan time, not only in the artifact.
      log.warn(formatWarning(missing));
    }
  }

  // ── Phase 1: read + parse + emit local definitions ──────────────────────
  for (const file of files) {
    const source = await readFile(file, "utf8").catch(() => "");
    if (!source) {
      parseProgress.tick();
      continue;
    }
    let parsed: ParsedFile;
    try {
      parsed = parseByExt(file, source, reportSyntaxErrors);
    } catch (err) {
      // parseByExt throws on unrecoverable syntax (EOF mid-expression, malformed
      // SFC). Warn and skip the file so one broken file can't tank the scan.
      log.warn(`Skipped ${file}: couldn't parse it (${errorMessage(err)}).`, errorStack(err));
      parseProgress.tick();
      continue;
    }
    if (parsed.kind === "unsupported") {
      parseProgress.tick();
      continue;
    }
    const relPath = posixPath(relative(cfg.configDir, file));
    // Detectors get outputRoot-relative POSIX paths, the form seeds and
    // occurrences use, so their ids join without another normalisation step.
    const outRel = rebase(relPath);
    if (parsed.kind === "babel") {
      declaredByFile.set(outRel, extractReactDeclaredProps(parsed.ast));
      localDefs.push(...detectWebComponents(parsed.ast, source, outRel));
      // Script mode finds Vue `defineComponent` calls in plain .ts/.js files, as
      // local-index/index.ts does for non-SFC files.
      localDefs.push(...detectVueComponents({ kind: "script", program: parsed.ast, source: parsed.source }, outRel));
      // relPath is scanRoot-relative POSIX, the form graph keys use.
      try {
        const fileBuilder = graphBuilder.beginFile(relPath);
        emitReact({
          file: relPath,
          source,
          ast: parsed.ast,
          fileBuilder,
        });
      } catch (err) {
        log.warn(`Couldn't finish reading ${file} (${errorMessage(err)}), so some occurrences in it may be missing.`, errorStack(err));
      }
    } else if (parsed.kind === "vue") {
      const wrapper = parsed.scriptAst !== undefined
        ? {
            descriptor: parsed.descriptor,
            scriptProgram: parsed.scriptAst,
            ...(parsed.plainScriptAst !== undefined ? { plainScriptProgram: parsed.plainScriptAst } : {}),
          }
        : { descriptor: parsed.descriptor };
      const sfcDefs = detectVueComponents({ kind: "sfc", wrapper }, outRel);
      localDefs.push(...sfcDefs);

      try {
        const fileBuilder = graphBuilder.beginFile(relPath, "vue");
        emitVueTemplate({
          file: relPath,
          wrapper,
          fileBuilder,
          // Reuse detectVueComponents' resolved symbol so the SFC's local-index
          // seed and the engine's owner ComponentId hash to the same id.
          // Otherwise the SFC seed is pruned as an unreachable local.
          ...(sfcDefs[0]?.exportName !== undefined ? { sfcSymbol: sfcDefs[0].exportName } : {}),
          ...(autoImports !== null ? { resolveAutoImport: autoImports.lookup } : {}),
        });
      } catch (err) {
        log.warn(`Couldn't finish reading ${file} (${errorMessage(err)}), so some occurrences in it may be missing.`, errorStack(err));
      }
    }
    parseProgress.tick();
  }

  parseProgress.done();
  const matching = startPhase({ label: "Matching occurrences to components…", writer, isTTY, columns });
  const localIndex = buildLocalIndex(localDefs);

  // ── Resolve phase: engine walks the populated graph ──────────────────────
  const declaredIn = createDeclaredDependencyTest(workspaceGraph);
  // Repository-relative package.json that declares each package the engine
  // found declared, from the first file that asked.
  const declaringManifest = new Map<string, string>();
  const absoluteFromGraphKey = (fromFile: string): string =>
    isAbsolute(fromFile) ? fromFile : resolve(cfg.configDir, fromFile);
  // Bounded re-export resolver pins an unparsed first-party file's identity to
  // its definition file so ids are scope-invariant between whole-repo and
  // single-app scans. Only invoked for first-party files outside the graph.
  const firstParty = (p: string): boolean => isFirstPartyPath(workspaceGraph, p);
  const boundedDefinitions = createBoundedDefinitionResolver({
    moduleResolver: resolveImport,
    firstParty,
    onWarning: (msg) => scanWarning(msg),
    onSyntaxErrors: reportSyntaxErrors,
  });
  const resolveOpts: ResolveOpts = {
    // Follow external aggregator barrels to the leaf package that
    // defines the export, keyed by the entry the chain crossed into it by.
    // Graph keys are configDir-relative, so they are made absolute for Node
    // resolution. The engine ignores same-package hits.
    resolveExternalLeaf: (fromFile, specifier, exportName) =>
      lazyResolver.lookupExternalLeaf(absoluteFromGraphKey(fromFile), specifier, exportName),
    collector: graphKeyCollector,
  };
  // Hooks attach at build() time so the engine's binding resolver reaches them
  // through the Graph.
  const graph = graphBuilder.build({
    firstParty,
    resolveLocalDefinition: boundedDefinitions.resolveDefinition,
    // Graph keys are configDir-relative; both predicates read absolute paths.
    isDeclaredDependency: (fromFile, packageName) => {
      const manifest = declaredIn(absoluteFromGraphKey(fromFile), packageName);
      if (manifest === null) return false;
      if (!declaringManifest.has(packageName)) {
        declaringManifest.set(packageName, posixPath(relative(outputRoot, manifest)));
      }
      return true;
    },
    isInstalledPackage: (fromFile, packageName) => isInstalledPackage(absoluteFromGraphKey(fromFile), packageName),
  });
  const { occurrences: engineOccurrences, registry } = resolveGraph(graph, resolveOpts);

  const t1 = performance.now();

  const rawDiagnostics = collector.drain();

  // The missing-manifest warning already printed as the scan started.
  const printed = diagnosticLogLines(rawDiagnostics.filter((d) => d.code !== "auto-import-manifest-missing"));
  if (!quiet) for (const line of printed.warnings) log.warn(line);
  for (const line of printed.counts) log.detail(line);

  // Rebase absolute diagnostic filePaths to outputRoot-relative POSIX; relative
  // filePaths pass through unchanged. The warn logs above print the diagnostics
  // before this step, so absolute paths stay absolute there.
  const diagnostics = rawDiagnostics.map((d) =>
    "filePath" in d && isAbsolute(d.filePath) ? { ...d, filePath: posixPath(relative(outputRoot, d.filePath)) } : d,
  );

  // Registry entries are keyed by graph key (configDir-relative) and the roster
  // lives in output space, so rebase them before the join.
  const rebasedEntries = registry.localEntries().map((e) => ({ ...e, filePath: rebase(e.filePath) }));
  // Output-space path → graph key: the inverse of `rebase` over the graph's files.
  const graphKeyByOutputPath = new Map<string, string>();
  for (const graphKey of graph.files.keys()) graphKeyByOutputPath.set(rebase(graphKey), graphKey);
  const rosterRegistry: RosterRegistry = {
    // A file outside the graph is answered from the files the bounded
    // definition resolver parsed to pin it.
    declarationOf: (filePath, exportName) => {
      const graphKey = graphKeyByOutputPath.get(filePath);
      return graphKey === undefined
        ? boundedDefinitions.declarationOf(resolve(outputRoot, filePath), exportName)
        : registry.declarationOf(graphKey, exportName);
    },
    localEntries: () => rebasedEntries,
  };
  const seedsById = new Map(
    buildComponentSeeds(localIndex, outputRoot, workspaceGraph, rosterRegistry, meta.repo.id, declaredByFile).map(
      (seed) => [seed.id, seed],
    ),
  );
  // Project engine occurrences into output space (outputRoot-relative POSIX),
  // so the ids emitArtifact derives match the seeds built from the local index.
  // Also seed each component the engine found that has no seed yet: without
  // one it is missing from components[], and composition edges to it are
  // dropped in applyCompositionRollup.
  const outputOccurrences: EngineOccurrence[] = engineOccurrences.map((eo) => {
    // `via` is always `viaChain[0]`, so derive it from the normalised chain to
    // keep the two in sync.
    const normalisedViaChain = eo.viaChain.map((v) => normaliseVia(v, cfg.configDir, rebase));
    const via = normalisedViaChain[0] ?? normaliseVia(eo.via, cfg.configDir, rebase);
    const outputSpace = {
      // eo.filePath is a scanRoot-relative graph key.
      filePath: rebase(eo.filePath),
      via,
      viaChain: normalisedViaChain,
      ...(eo.rawOwnerComponentId !== undefined
        ? { rawOwnerComponentId: normaliseEngineLocalId(eo.rawOwnerComponentId, cfg.configDir, rebase) }
        : {}),
    };
    // An unresolved occurrence names no component, so it seeds none.
    if (eo.rawComponentId === undefined) return { ...eo, ...outputSpace };

    const normalisedComponentId = normaliseEngineLocalId(eo.rawComponentId, cfg.configDir, rebase);

    // buildComponentSeeds already seeded registry members; this covers external
    // components and local identities outside the roster.
    if (!seedsById.has(scanIdOf(normalisedComponentId, meta.repo.id))) {
      let declaration: ReturnType<RosterRegistry["declarationOf"]>;
      let declared: DeclaredPropApi | undefined;
      if (normalisedComponentId.kind === "react-component" && normalisedComponentId.source.type === "local") {
        const { filePath } = normalisedComponentId.source;
        declaration = rosterRegistry.declarationOf(filePath, normalisedComponentId.export);
        declared = declaration && declaredByFile.get(filePath)?.get(declaration.symbol);
      }
      const definition = declaration?.loc ?? eo.definition;
      const seed = seedFor(normalisedComponentId, {
        repoId: meta.repo.id,
        workspaceGraph,
        outputRoot,
        ...(definition !== undefined ? { definition } : {}),
        ...(declared ? { declared } : {}),
      });
      seedsById.set(seed.id, seed);
    }

    return { ...eo, rawComponentId: normalisedComponentId, ...outputSpace };
  });

  // A tag's registration constructor or GlobalComponents import, denoted by
  // the engine (`denoteName`), then named as its scan-file identity names it: a
  // repository declaration or a package export.
  const attributionTargetOf = (denoted: ReturnType<typeof denoteName>): AttributionTarget | null => {
    if (denoted === null || "unresolved" in denoted) return null;
    const componentId = normaliseEngineLocalId(denoted.rawComponentId, cfg.configDir, rebase);
    const identity = toIdentity(componentId, meta.repo.id);
    if (identity.kind === "repository-declaration") {
      const { repoId, filePath, exportName } = identity;
      return { kind: "repository", repoId, filePath, exportName };
    }
    if (identity.kind === "package-export") return { kind: "package", packageName: identity.packageName };
    return null;
  };
  const resolveTarget: TargetResolver = {
    registration: (filePath, className) => {
      const graphKey = graphKeyByOutputPath.get(filePath);
      if (graphKey === undefined) return null;
      return attributionTargetOf(denoteName(graph, { kind: "binding", filePath: graphKey, symbol: className }, resolveOpts));
    },
    globalDeclaration: (declarationPath, specifier, imported) => {
      const fromFile = posixPath(relative(cfg.configDir, declarationPath));
      return attributionTargetOf(denoteName(graph, { kind: "export", fromFile, specifier, imported }, resolveOpts));
    },
  };

  const artifact = await emitArtifact({
    meta,
    repoId: meta.repo.id,
    seeds: [...seedsById.values()],
    occurrences: outputOccurrences,
    diagnostics,
    tagEvidence: tagEvidenceSources({
      localIndex,
      cemIndex,
      globalComponents: autoImports,
      resolveTarget,
      outputRoot,
    }),
    declaredIn: declaringManifest,
    // Scan-file paths are outputRoot-relative, so versions are read from
    // outputRoot, not cfg.configDir.
    readVersion: installedVersionReader(outputRoot),
  });

  if (!quiet) {
    for (const d of artifact.diagnostics) if (d.code === "dependency-not-installed") log.warn(formatWarning(d));
  }

  const validation = validateArtifact(artifact);
  if (!validation.ok) {
    const at = validation.reason === "invalid_artifact" ? validation.path : "meta.schemaVersion";
    const { bugs } = readCliPackage();
    throw new CliError(
      `Scout built a scan file that fails its own format check (at ${at}). This is a bug in Scout: please report it${bugs !== undefined ? ` at ${bugs}` : ""}.`,
      1,
    );
  }

  matching.done();
  const stats = buildScanStats({
    filesScanned: files.length,
    scanDurationMs: Math.round(t1 - startedAt),
    components: artifact.components,
    occurrences: artifact.occurrences,
  });

  return { artifact, stats };
}

/**
 * Whether writing to `target` lands inside `dir` (a realpath), following symbolic links
 * in the path. A link at `target` that points at nothing yet counts as outside: writing
 * would create the file wherever it points.
 */
async function writesInside(dir: string, target: string): Promise<boolean> {
  const physical = await physicalPath(target);
  if (physical === null) return false;
  const rel = relative(dir, physical);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** `path` with every symbolic link in its existing part resolved, or null for a link to nothing. */
async function physicalPath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if ((await lstat(path).catch(() => null))?.isSymbolicLink()) return null;
  const parent = dirname(path);
  if (parent === path) return path;
  const physicalParent = await physicalPath(parent);
  return physicalParent === null ? null : join(physicalParent, basename(path));
}

/**
 * Normalise a local-source ComponentId's filePath to output space
 * (outputRoot-relative POSIX) so its hash matches the seeds built from the
 * local index.
 *
 * The engine emits either an absolute path (a relative import whose target
 * isn't a graph key) or a scanRoot-relative graph key (the usual case, and
 * always the case for owners). `rebase` expects scanRoot-relative input, so
 * an absolute path is made relative first.
 */
function normaliseEngineLocalId(
  c: import("@scoutui/reference-graph").ComponentId,
  configDir: string,
  rebase: (scanRel: string) => string,
): import("@scoutui/reference-graph").ComponentId {
  if (c.source.type !== "local") return c;
  const fp = c.source.filePath;
  const scanRel = isAbsolute(fp) ? posixPath(relative(configDir, fp)) : fp;
  return {
    ...c,
    source: { type: "local", filePath: rebase(scanRel) },
  };
}

/**
 * Project a via hop into output space. The file a `helper-call`,
 * `dynamic-map` or `prop-forward` hop names is a graph key, rebased like the
 * occurrence's own `filePath`. An absolute `specifier` is rebased too: the
 * GlobalComponents reader (scan/global-components.ts) emits absolute
 * specifiers for in-repo entries, which would otherwise leak machine-local
 * paths into the artefact. Authored specifiers are never absolute.
 */
function normaliseVia(
  v: OccurrenceVia,
  configDir: string,
  rebase: (scanRel: string) => string,
): OccurrenceVia {
  if (v.kind === "helper-call") return { ...v, calleeFile: rebase(v.calleeFile) };
  if (v.kind === "dynamic-map") return { ...v, mapLoc: { ...v.mapLoc, file: rebase(v.mapLoc.file) } };
  if (v.kind === "prop-forward") {
    return { ...v, constructionSite: { ...v.constructionSite, file: rebase(v.constructionSite.file) } };
  }
  if (!("specifier" in v) || v.specifier === undefined || !isAbsolute(v.specifier)) return v;
  const scanRel = posixPath(relative(configDir, v.specifier));
  return { ...v, specifier: rebase(scanRel) };
}
