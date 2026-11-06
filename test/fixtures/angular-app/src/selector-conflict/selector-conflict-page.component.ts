import { Component } from "@angular/core";

// Neither ThingOneComponent nor ThingTwoComponent is imported anywhere in
// this repo, and both declare selector "app-thing". The use below must
// resolve to neither: ambiguous, not a guess at one of the two.
@Component({
  selector: "app-selector-conflict-page",
  template: "<app-thing></app-thing>",
})
export class SelectorConflictPageComponent {}
