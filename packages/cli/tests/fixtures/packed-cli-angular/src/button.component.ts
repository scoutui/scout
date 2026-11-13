import { Component, input } from "@angular/core";

@Component({
  selector: "ex-button",
  template: "<button><ng-content /></button>",
})
export class ButtonComponent {
  label = input("");
}
