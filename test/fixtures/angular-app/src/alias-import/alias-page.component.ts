import { Component } from "@angular/core";
import { AliasBadgeComponent } from "@alias-shared";

@Component({
  selector: "app-alias-page",
  imports: [AliasBadgeComponent],
  template: `<app-alias-badge text="New" />`,
})
export class AliasPageComponent {}
