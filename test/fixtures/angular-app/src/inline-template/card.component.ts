import { Component } from "@angular/core";
import { TagComponent } from "./tag.component";

@Component({
  selector: "app-card",
  imports: [TagComponent],
  template: `
    <section>
      <app-tag text="New"></app-tag>
      <p>{{ body }}</p>
    </section>
  `,
})
export class CardComponent {
  body = "Hello";
}
