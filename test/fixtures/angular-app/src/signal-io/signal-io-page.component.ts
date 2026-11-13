import { Component } from "@angular/core";
import { CounterComponent } from "./counter.component";

@Component({
  selector: "app-signal-io-page",
  imports: [CounterComponent],
  template: '<app-counter [step]="2" [(value)]="total"></app-counter>',
})
export class SignalIoPageComponent {
  total = 0;
}
