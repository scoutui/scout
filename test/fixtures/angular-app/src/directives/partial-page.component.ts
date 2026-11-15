import { Component } from "@angular/core";

declare function extraImports(): unknown[];

// Nothing in `imports` can be read, so every directive the template writes is a candidate: `appTip` has one class
// and counts; `appMark` has two (MarkOneDirective, MarkTwoDirective), so neither counts.
@Component({
  selector: "app-directives-partial-page",
  imports: [extraImports()],
  template: `<span appTip></span><span appMark></span>`,
})
export class DirectivesPartialPageComponent {}
