// Stand-in for `@angular/core`. Fixture repos depend on it so a real install
// would resolve, but Scout's detector and emitter read Angular source and
// `@angular/compiler` output directly: nothing in the scan ever requires
// `@angular/core` itself, so this package only has to exist, not work.
module.exports = {};
