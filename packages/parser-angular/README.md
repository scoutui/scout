# @scoutui/parser-angular

Finds the components used in Angular templates for the [Scout](https://scoutui.dev) CLI: the components each template renders, matched to their declarations by selector, and the inputs and outputs bound at each use.

`@angular/compiler` isn't a dependency: the CLI loads the copy installed in the repo it scans, so templates are read with that repo's own Angular version.

This package is internal and isn't published. The CLI bundles it, so a change needs a `@scoutui/cli` changeset. [Framework support](https://scoutui.dev/docs/reference/framework-support) describes what a scan reads in Angular code.
