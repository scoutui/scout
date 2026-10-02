# Coding standards

This is what review checks in a pull request's code and tests. [CONTRIBUTING.md](CONTRIBUTING.md) covers the rest: setting up the repository, commits, changesets and opening the pull request.

## Writing code

- **Keep it generic.** Scout works with any design system, so source code never hardcodes one: no prefix checks and no package-scope matches like `@your-ds/*`. A specific design system appears only in fixtures and examples.
- **Invent names in fixtures.** A fixture can model a public design system, but never copy identifiers from a real company's codebase: this repository is public, and their code often isn't. Use made-up names such as `@example/*`.
- **Reuse shared logic.** Rules that several places depend on, such as identity hashing or path normalisation, live in one function. Call it rather than writing the rule again, so the copies can't drift apart.
- **Write messages for the user.** Errors, warnings and status lines say what happened and what to do next, in the user's terms and without implementation detail.
- **Comments and test titles say what the code does,** plus anything a reader can't see from the line itself. Reasons and history belong in the pull request or the changeset. When you point to something, use what any reader can open: a public issue or a file in the repository.
- **Keep package scripts in the package.** Each package's `package.json` holds its scripts, and the root runs them with `turbo run`. Write `turbo run` in committed files rather than the `turbo` shorthand.
- **Compatibility:** until 1.0, CLI flags and config fields can change in a minor release, and the changeset tells users what changed. The scan format is the exception: see [Changing the scan format](#changing-the-scan-format).

## Tests

A test earns its place by failing when the behaviour it covers breaks. A test that can't fail still has to be maintained, and it makes the suite look safer than it is.

### Where a test belongs

- **Prefer end-to-end tests.** For the scanner, scan a fixture repo with the CLI and assert on the exact output: which component each usage resolves to, its owner and its props. Counts aren't enough, because a count can stay the same while the scanner credits the wrong component. These tests live in `packages/cli/tests/integration/`, and the fixture repos in `test/fixtures/`. For the dashboard, call a route against a real database and check the response body.
- **Use unit tests for rules with many edge cases** that fixtures don't reach, such as identity hashing or resolver branches. Test through each package's public API, and feed resolver tests real parser output rather than hand-built input, which can reach branches real code never does.
- **Test each behaviour once, at one level:** a unit test or an end-to-end test, not both. Before you add a test, look for where the behaviour is already tested and extend that test. When one bug turns four test files red, every later change to that behaviour means editing all four.
- **Name a fixture repo after what it checks,** and use that name for its folder, its `package.json` name and its `repoId`. A stand-in package is called `@example/<what>`: put it in `test/fixtures/example-<what>` if several fixtures install it, or commit it in the fixture's own `node_modules` if only one does.

### Writing a test

- **Make sure a new test can fail.** Revert your change, or break the code it covers, and watch the test go red.
- **Give each case its own row** in a table-driven test, and combine values only where they interact. When every row combines every input, the code can start ignoring one of them and every row still passes.
- **Pair a negative case with a positive one.** A test that the scanner reports no component for some code also passes when the scanner is broken entirely, so add similar code that should produce one.
- **Test runtime behaviour, not types.** In most packages Vitest runs `expectTypeOf` and similar checks without checking the types, so they pass whatever the types say.
- **Record a known bug as `it.fails`** with the correct expectation, rather than as a passing test of the wrong answer. The test then states the right behaviour, and the fix only has to remove `.fails`.

### Baselines

- **A byte-identity test shows that nothing changed, not that the output is right.** Use it for refactors and determinism checks, never as the only test of a behaviour.
- **Read the diff before you regenerate a baseline.** A regenerated baseline accepts whatever changed, so a regression is easy to miss. In the pull request, explain each change it records, apart from timestamps and scan ids.

## Changing what the scanner reports or stores

Scout turns what it finds in source code into components, occurrences and origins, and every chart in the dashboard is built on them. A change that quietly redefines one of them changes what those charts mean. So take extra care with identity, occurrences, attribution, the scan file, stored data and history.

The scanner keeps two promises:

- **A reference it can name stays an occurrence,** whether it points into `node_modules` or into the repo itself. There's no allowlist of packages or design systems. A reference it can't resolve carries the reason, never an invented identity. A render it can't follow, such as a component passed in as a prop, is reported as a diagnostic or not at all.
- **Identity takes one of three shapes.** A package export is `{packageName, publicEntry, exportName}`, where `packageName` is the package that declares the component. A repository declaration is `{repoId, filePath, exportName}`. A tag is `{tagName}`, and which package or declaration provides it is worked out for each scan from that scan's evidence.

Before you change one of these areas, answer these in the issue or pull request:

1. **User value:** what question can a user now answer, or what can they now do?
2. **What's counted:** what is represented, and at what level (occurrence, component, repo or scan)?
3. **Evidence:** is it observed directly, resolved reliably, or a heuristic?
4. **Downstream meaning:** how will the scan file, the dashboard's charts and governance read it?
5. **History:** do IDs, charts, saved dashboard selections or URLs need migrating?

Keep four layers apart, and decide each on its own evidence:

- **Observation:** what exists in the source code.
- **Resolution:** what evidence connects it to something.
- **Identity:** which component Scout says it is.
- **Projection:** how the dashboard shows or adds it up.

If resolution evidence changes attribution, identity or projection, that's a product decision: say so in the pull request.

Then say which kind of change yours is:

- **Local correction:** the code changes, but what the scanner writes and the dashboard stores means the same.
- **Semantic change:** what the scanner finds or resolves changes, but what's counted, how it's identified and how it's stored stay the same. Include an example that goes from source code, to the scan file, to what the dashboard shows.
- **Model change:** adds, removes or redefines what's counted, how a component is identified, the scan file's shape or what stored history means. Agree the design in an issue before you build it, including what happens to data that's already stored.

A bug fix doesn't introduce a new product concept. If you need one, explain in the issue why an existing concept can't represent it, what it gives users, and whether it replaces anything.

### Check against a real repo

Fixtures can pass while real repos break, so changes to the scanner, the parsers, the resolver or the scan file need a before-and-after scan of a real repo.

1. On the base commit, build the CLI: `yarn turbo run build --filter=@scoutui/cli`.
2. In the repo you're testing against, scan it: `node <this-repo>/packages/cli/dist/cli.js scan --dry-run`, then `mv scout-scan.json BEFORE.json`. If the repo has no config yet, run `node <this-repo>/packages/cli/dist/cli.js init` first.
3. Build again with your change, scan the same way, and `mv scout-scan.json AFTER.json`.
4. Compare the two with `<this-repo>/consumer-ci/compare-scans.sh BEFORE.json AFTER.json` (it needs `jq`). It fails if a usage went missing or lost its component, or if a component went missing. If your change is meant to move some, list them in a file and pass it with `--expect FILE`; the script's header describes the format.

The public repos the nightly scans use are ready to go: `yarn workspace consumer-ci run cadence --target <name> --step prepare --work-dir <dir>` clones and installs one. See [`consumer-ci/README.md`](consumer-ci/README.md).

In the pull request, say which counts you expected to change and which did. Name the repo if it's public; if it's private, give the counts only.

### Changing the scan format

Teams pin the CLI in each repository, and whoever runs the dashboard upgrades it on their own schedule. Whether the two work together depends on the scan format version (`SCHEMA_VERSION` in `packages/scan-format/src/schema-version.ts`), not on the CLI's version number.

Every format change keeps two things true:

- **Stored scans stay readable.** The dashboard reads every format it has stored, converting an older one each time it reads it. A scan's uploaded file is never rewritten, and never deleted while the scan exists: it's the only copy, and every rebuild reads it.
- **CLIs one format behind keep working.** From the first format change on, the dashboard accepts uploads in its own format and the one before.

**When to raise the version:** only when a dashboard that knows just the previous format would get a scan in the new one wrong, by counting something it shouldn't, rejecting a value in a strict list or misreading a field whose meaning changed. These aren't format changes:

- a new optional field an older dashboard can ignore and still answer correctly;
- a new value in an open list (one `schema.ts` builds with `openKinds` or `openValue`);
- removing an optional field nothing reads.

**A format change ships as two pull requests,** so dashboards can upgrade before any CLI writes the new format:

1. **The dashboard** accepts the new format as well as its own, converts the previous format wherever uploads and stored scans are read, and shows "no data" (never 0) for information older scans don't have. Its test rebuilds a stored scan in the previous format and checks the answers stay the same.
2. **The CLI** writes the new format. Release it at least a week after the dashboard, so dashboards can upgrade first. Its changeset says `Writes scan format N. Needs dashboard web-app@x or newer.` It's a breaking change for CLI users, because their dashboard has to be upgraded first, so the bump is minor before 1.0 and major after.

**The JSON Schema** in `packages/scan-format/schema/scan-file.schema.json` is generated from `schema.ts`, and a test fails when it's out of date. Read the diff, regenerate it with `yarn workspace @scoutui/scan-format test -u`, and say in the pull request whether the change is additive or a format change. The schema can't express every check, such as rules across fields, so `validateArtifact` has the final word on what a dashboard accepts.
