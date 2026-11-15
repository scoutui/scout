import { Directive, Input } from "@angular/core";

// Owns an element and an attribute: `<app-field>` and `<span appField>` are both its uses.
@Directive({ selector: "app-field, [appField]" })
export class FieldDirective {
  @Input() label = "";
}
