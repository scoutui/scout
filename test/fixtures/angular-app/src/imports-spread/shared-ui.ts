import { SpreadButtonComponent } from "./spread-button.component";

// A plain constant, not an `@Component`/`@NgModule` file: nothing here
// declares an Angular class, so the detector never sees SpreadButtonComponent
// listed in this array literal at all.
export const SHARED_UI = [SpreadButtonComponent];
