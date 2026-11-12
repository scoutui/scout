import { Directive } from "@angular/core";

// Same selector as MarkOneDirective, in another file.
@Directive({ selector: "[appMark]" })
export class MarkTwoDirective {}
