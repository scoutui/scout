import { Component } from "@angular/core";

@Component({
  selector: "app-frame",
  template: '<div class="frame"><ng-content></ng-content></div>',
})
export class FrameComponent {}
