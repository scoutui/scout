import { NgModule } from "@angular/core";
import { WidgetModule } from "./widget.module";
import { PanelComponent } from "./panel.component";

@NgModule({
  declarations: [PanelComponent],
  imports: [WidgetModule],
  exports: [PanelComponent],
})
export class PanelModule {}
