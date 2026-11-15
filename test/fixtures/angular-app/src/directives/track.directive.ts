import { Directive, EventEmitter, Output } from "@angular/core";

@Directive({ selector: "[appTrack]" })
export class TrackDirective {
  @Output() tracked = new EventEmitter<void>();
}
