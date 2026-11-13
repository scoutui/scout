import { Component } from "@angular/core";
import { ButtonComponent } from "./button.component";

@Component({
  selector: "ex-root",
  imports: [ButtonComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent {}
