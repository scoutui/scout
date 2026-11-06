import { Component } from "@angular/core";

// v20+ naming convention: the root component file is `app.ts`, class `App`,
// rather than `app.component.ts` / `AppComponent`.
@Component({
  selector: "app-root2",
  template: "<div>v20 app.ts naming</div>",
})
export class App {}
