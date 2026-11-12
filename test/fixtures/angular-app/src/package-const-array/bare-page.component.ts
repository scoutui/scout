import { Component } from "@angular/core";
import { ExampleImports } from "@example/ng-imports";

// A const array an installed package exports, listed as it is.
@Component({
  selector: "app-pkg-array-bare-page",
  imports: [ExampleImports],
  template: `<ex-badge></ex-badge>`,
})
export class PkgArrayBarePageComponent {}
