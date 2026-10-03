---
"@scoutui/cli": patch
---

The scan now counts more of the components your code imports, and names more of them correctly:

- After `const AliasedStar = Icons.Star`, with `Icons` imported from a package, `<AliasedStar />` counts as `Icons.Star`, the same as `<Icons.Star />`.
- Members of `export * as Shapes from "./shapes"`, such as `<Shapes.Circle />`, count for the files that declare them.
- More components imported through a folder outside `include`, or matched by `exclude`, now get the same name, and the same file or package, as when that folder is scanned:
  - A Vue component keeps its own name instead of `default`, and the scan no longer warns "Stopped following re-exports" for it.
  - Members of `export * as Shapes from …`, or of `import * as Shapes from …` exported again with `export { Shapes }`, in that folder count for the file or package that declares them.
  - A component from `export * from` a package counts for the package instead of a file inside `node_modules`.

A folder below the config's folder that holds its own git repository, such as a submodule or another clone, is no longer scanned as part of your repository, and an `include` pattern that points into one now matches nothing.
