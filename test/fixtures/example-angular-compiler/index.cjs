// Stand-in for `@angular/compiler` so fixture repos don't commit a real,
// 45 MB install of it (see CODING_STANDARDS.md "Check against a real repo").
// `stage-fixture.ts` installs this package wherever a fixture depends on
// `@angular/compiler`, by name alone (it doesn't check semver ranges), so the
// scanned repo's `require("@angular/compiler")` resolves here. The real
// compiler comes from one of `packages/cli`'s `@angular/compiler-NN` npm
// aliases (devDependencies); test setup points `SCOUT_TEST_ANGULAR_COMPILER`
// at the one under test before the CLI's child process starts, and the
// child process inherits that env var.
function resolveCompiler() {
  const path = process.env.SCOUT_TEST_ANGULAR_COMPILER;
  if (!path) {
    throw new Error(
      "This fixture's @angular/compiler stand-in needs SCOUT_TEST_ANGULAR_COMPILER set to a real " +
        "@angular/compiler entry point, e.g. require.resolve('@angular/compiler-21') resolved from " +
        "packages/cli's devDependencies. Test setup sets this per matrix row; it was unset here.",
    );
  }
  return require(path);
}

module.exports = resolveCompiler();
