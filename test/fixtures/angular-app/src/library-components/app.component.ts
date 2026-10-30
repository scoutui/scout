import { Component } from "@angular/core";
import { ExCard, ExCardModule } from "@example/ng-ui/card";
import { ExButton } from "@example/ng-ui";

@Component({
  selector: "app-library-components",
  standalone: true,
  imports: [ExCard, ExCardModule, ExButton],
  templateUrl: "./app.component.html",
})
export class AppComponent {
  t = "Card title";

  x(): void {}
}
