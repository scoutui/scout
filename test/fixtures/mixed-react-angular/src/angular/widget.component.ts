import { Component, input } from "@angular/core";

@Component({
  selector: "app-ng-widget",
  template: "<span>{{ label() }}</span>",
})
export class WidgetComponent {
  label = input("");
}
