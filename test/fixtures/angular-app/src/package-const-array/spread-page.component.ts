import { Component } from "@angular/core";
import { ExampleImports } from "@example/ng-imports";

// The same array, spread into the list.
@Component({
  selector: "app-pkg-array-spread-page",
  imports: [...ExampleImports],
  template: `<ex-badge></ex-badge>`,
})
export class PkgArraySpreadPageComponent {}
