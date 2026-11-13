import { Component } from "@angular/core";
import { SpreadCardComponent } from "./card.component";
import { SHARED_UI } from "./shared-ui";

// `imports: [SpreadCardComponent, ...SHARED_UI]`: the scope is SpreadCardComponent
// plus every member of SHARED_UI, which holds SpreadButtonComponent.
@Component({
  selector: "app-imports-spread-page",
  imports: [SpreadCardComponent, ...SHARED_UI],
  template: `
    <app-spread-card></app-spread-card>
    <app-spread-button></app-spread-button>
  `,
})
export class ImportsSpreadPageComponent {}
