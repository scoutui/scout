import { Component, EventEmitter, Input, Output } from "@angular/core";

@Component({
  selector: "app-toggle",
  template: '<button (click)="flip()">{{ label }}</button>',
})
export class ToggleComponent {
  @Input() label = "";
  @Input("checkedState") checked = false;
  @Output() toggled = new EventEmitter<boolean>();

  flip() {
    this.checked = !this.checked;
    this.toggled.emit(this.checked);
  }
}
