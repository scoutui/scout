import { Component, input } from "@angular/core";

@Component({
  selector: "app-badge",
  template: "<span>{{ text() }}</span>",
})
export class BadgeComponent {
  text = input("");
}
