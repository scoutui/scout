import { Component, input } from "@angular/core";

@Component({
  selector: "app-tag",
  template: '<span class="tag">{{ text() }}</span>',
})
export class TagComponent {
  text = input("");
}
