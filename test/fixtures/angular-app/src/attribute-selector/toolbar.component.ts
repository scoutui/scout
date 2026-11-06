import { Component } from "@angular/core";
import { IconButtonComponent } from "./icon-button.component";

@Component({
  selector: "app-toolbar",
  imports: [IconButtonComponent],
  template: '<button app-icon-button>Save</button>',
})
export class ToolbarComponent {}
