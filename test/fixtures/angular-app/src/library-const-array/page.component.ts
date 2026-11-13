import { Component } from "@angular/core";
import { SHARED_LIBRARY } from "./shared-modules";

@Component({
  selector: "app-library-const-array",
  imports: [...SHARED_LIBRARY],
  template: `<ex-shared-badge>New</ex-shared-badge>`,
})
export class LibraryConstArrayPageComponent {}
