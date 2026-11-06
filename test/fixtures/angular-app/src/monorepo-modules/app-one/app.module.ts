import { NgModule } from "@angular/core";
import { OneHeaderComponent } from "./header.component";
import { AppRootComponent } from "./app-root.component";

// Both apps' root module is literally named "AppModule" (Angular CLI's own
// default), and both declare a class named "AppRootComponent": the exact
// collision shape described in the review ("two apps in a monorepo that
// each have an AppModule").
@NgModule({
  declarations: [OneHeaderComponent, AppRootComponent],
})
export class AppModule {}
