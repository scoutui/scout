import { Directive, Input } from "@angular/core";

// A structural directive: `*appIf` is control flow, never counted.
@Directive({ selector: "[appIf]" })
export class IfDirective {
  @Input() appIf = false;
}
