import { Component } from "@angular/core";
import { NgModel } from "@angular/forms";
import { ExForm, ExTooltip, ExTooltipModule } from "@example/ng-ui/tooltip";
import { DirButtonComponent } from "./dir-button.component";
import { FieldDirective } from "./field.directive";
import { IfDirective } from "./if.directive";
import { TipDirective } from "./tip.directive";
import { TrackDirective } from "./track.directive";

@Component({
  selector: "app-directives-page",
  imports: [DirButtonComponent, FieldDirective, TipDirective, TrackDirective, IfDirective, ExTooltip, ExTooltipModule, ExForm, NgModel],
  templateUrl: "./page.component.html",
})
export class DirectivesPageComponent {}
