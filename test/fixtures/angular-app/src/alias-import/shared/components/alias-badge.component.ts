import { Component, input } from "@angular/core";

@Component({
  selector: "app-alias-badge",
  template: "<span>{{ text() }}</span>",
})
export class AliasBadgeComponent {
  text = input("");
}
