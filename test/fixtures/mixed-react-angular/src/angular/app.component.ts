import { Component } from "@angular/core";
import { WidgetComponent } from "./widget.component";

@Component({
  selector: "app-ng-root",
  imports: [WidgetComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent {}
