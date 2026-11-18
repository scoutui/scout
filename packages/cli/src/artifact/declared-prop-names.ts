import type { Occurrence } from "@scoutui/scan-format";
import { camelize } from "@scoutui/parser-vue";
import type { ComponentRow } from "../rollup.js";

/**
 * The occurrences with each written prop named as the component receives it.
 * A Vue component gets a declared prop under its camelCase name whichever case
 * the template writes it in, so `is-preview` on a component that declares
 * `isPreview` is recorded as `isPreview`. An attribute the component doesn't
 * declare falls through as written, and so does every prop of a component
 * with no declared API or of another framework.
 */
export function withDeclaredPropNames(occurrences: readonly Occurrence[], rows: readonly ComponentRow[]): Occurrence[] {
  const vueDeclared = new Map<string, ReadonlySet<string>>();
  for (const row of rows) {
    if (row.framework === "vue" && row.declared !== undefined) vueDeclared.set(row.id, new Set(Object.keys(row.declared.props)));
  }
  return occurrences.map((o) => {
    const declared = o.resolution.status === "resolved" ? vueDeclared.get(o.resolution.componentId) : undefined;
    if (declared === undefined) return o;
    const renamed = (name: string): string => {
      const camel = camelize(name);
      return camel !== name && declared.has(camel) && !(camel in o.props) ? camel : name;
    };
    if (!Object.keys(o.props).some((name) => renamed(name) !== name)) return o;
    return { ...o, props: Object.fromEntries(Object.entries(o.props).map(([name, value]) => [renamed(name), value])) };
  });
}
