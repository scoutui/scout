import { ConstWidgetComponent } from "./widget.component";
import { HighlightDirective } from "./highlight.directive";

// Plain constants, not Angular classes: a component's `imports` names them to bring in what they hold.
export const WIDGET_IMPORTS = [ConstWidgetComponent] as const;
export const DIRECTIVE_IMPORTS = [HighlightDirective] as const;
export const ALL_IMPORTS = [...WIDGET_IMPORTS, DIRECTIVE_IMPORTS];
