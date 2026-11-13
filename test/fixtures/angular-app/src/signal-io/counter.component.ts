import { Component, input, model, output } from "@angular/core";

@Component({
  selector: "app-counter",
  template: '<button (click)="inc()">{{ value() }}</button>',
})
export class CounterComponent {
  step = input(1);
  value = model(0);
  overflowed = output<void>();

  inc() {
    this.value.set(this.value() + this.step());
  }
}
