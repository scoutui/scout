import { Component, input } from "@angular/core";

@Component({
  selector: "app-item",
  template: "<li>{{ text() }}</li>",
})
export class ItemComponent {
  text = input("");
}
