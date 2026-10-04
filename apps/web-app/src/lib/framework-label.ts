import type { ComponentKind } from "@scoutui/web-shared";

/** Human label for a component kind, used in headers/stat bands. */
export function frameworkLabel(kind: ComponentKind): string {
  switch (kind) {
    case "react-component": return "react";
    case "vue-component": return "vue";
    case "custom-element": return "web components";
    case "tag": return "undefined elements";
    default: return kind;
  }
}
