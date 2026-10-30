import { Component } from "@angular/core";
import { FrameComponent } from "./frame.component";
import { BadgeComponent } from "./badge.component";

@Component({
  selector: "app-projection-page",
  imports: [FrameComponent, BadgeComponent],
  template: '<app-frame><app-badge text="New"></app-badge></app-frame>',
})
export class ProjectionPageComponent {}
