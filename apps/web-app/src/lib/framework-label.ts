import type { ComponentKind } from "@scoutui/web-shared";

const COMPONENT_SUFFIX = "-component";

/** Human label for a component kind, used in headers/stat bands. A kind this dashboard doesn't
 *  know by name is the open `${framework}-component`; it labels as that framework's own name,
 *  never as react or a generic fallback. */
export function frameworkLabel(kind: ComponentKind): string {
  switch (kind) {
    case "react-component": return "react";
    case "vue-component": return "vue";
    case "custom-element": return "web components";
    case "tag": return "undefined elements";
    default: return kind.endsWith(COMPONENT_SUFFIX) ? kind.slice(0, -COMPONENT_SUFFIX.length) : kind;
  }
}
