import { Component } from "@angular/core";
import { App } from "./app";

@Component({
  selector: "app-host",
  imports: [App],
  template: "<app-root2></app-root2>",
})
export class AppHostComponent {}
