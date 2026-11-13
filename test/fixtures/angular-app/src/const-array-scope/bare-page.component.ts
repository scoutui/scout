import { Component } from "@angular/core";
import { WIDGET_IMPORTS } from "./scope-imports";

@Component({
  selector: "app-const-bare-page",
  imports: [WIDGET_IMPORTS],
  template: `<app-const-widget></app-const-widget>`,
})
export class ConstBarePageComponent {}
