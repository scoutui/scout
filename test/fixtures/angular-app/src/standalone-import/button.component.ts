import { Component, input, output } from "@angular/core";

@Component({
  selector: "app-button",
  standalone: true,
  template: '<button (click)="pressed.emit()"><ng-content /></button>',
})
export class ButtonComponent {
  label = input<string>("");
  variant = input<"primary" | "ghost">("primary");
  disabled = input(false);
  pressed = output<void>();
}
