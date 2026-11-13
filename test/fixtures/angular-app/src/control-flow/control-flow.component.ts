import { Component } from "@angular/core";
import { ItemComponent } from "./item.component";

@Component({
  selector: "app-control-flow",
  imports: [ItemComponent],
  templateUrl: "./control-flow.component.html",
})
export class ControlFlowComponent {
  items = ["a", "b", "c"];
  mode: "list" | "grid" | "empty" = "list";
}
