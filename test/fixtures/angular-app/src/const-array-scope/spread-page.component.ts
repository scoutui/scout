import { Component } from "@angular/core";
import { ALL_IMPORTS } from "./scope-imports";

@Component({
  selector: "app-const-spread-page",
  imports: [...ALL_IMPORTS],
  template: `<app-const-widget appHighlight></app-const-widget>`,
})
export class ConstSpreadPageComponent {}
