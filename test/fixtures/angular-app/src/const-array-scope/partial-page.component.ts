import { Component } from "@angular/core";
import { ConstWidgetComponent } from "./widget.component";

declare function extraImports(): unknown[];

// `extraImports()` can't be read, so the scope is only partly known: the widget
// listed beside it still resolves within that scope, without the decoy
// making the use ambiguous.
@Component({
  selector: "app-const-partial-page",
  imports: [ConstWidgetComponent, extraImports()],
  template: `<app-const-widget></app-const-widget>`,
})
export class ConstPartialPageComponent {}
