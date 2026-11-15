import { Directive, Input } from "@angular/core";

// Its selector's attribute is also an input: `[appTip]="text"` carries the input's value.
@Directive({ selector: "[appTip]" })
export class TipDirective {
  @Input() appTip = "";
  @Input() tipPosition = "";
}
