import { Component } from "@angular/core";
import { ToggleComponent } from "./toggle.component";

@Component({
  selector: "app-decorator-io-page",
  imports: [ToggleComponent],
  template: '<app-toggle label="Dark mode" [checkedState]="true" (toggled)="onToggle($event)"></app-toggle>',
})
export class DecoratorIoPageComponent {
  onToggle(_value: boolean) {}
}
