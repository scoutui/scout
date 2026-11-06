import { Component } from "@angular/core";
import { SpreadCardComponent } from "./card.component";
import { SHARED_UI } from "./shared-ui";

// `imports: [SpreadCardComponent, ...SHARED_UI]` can't be fully read: the
// spread's contents aren't known here, and SHARED_UI holds
// SpreadButtonComponent, which this list never names directly. The template
// scope falls back to global, the same way an empty `imports` list does,
// rather than silently dropping SpreadButtonComponent's use.
@Component({
  selector: "app-imports-spread-page",
  imports: [SpreadCardComponent, ...SHARED_UI],
  template: `
    <app-spread-card></app-spread-card>
    <app-spread-button></app-spread-button>
  `,
})
export class ImportsSpreadPageComponent {}
