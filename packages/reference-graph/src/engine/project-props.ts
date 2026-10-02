import type { PropValueState } from "@scoutui/scan-format";
import type { PropUsage } from "../types/prop-usage.js";

/** Project parser-emitted PropUsage[] onto the per-occurrence value map. */
export function projectPropUsages(usages: PropUsage[]): Record<string, PropValueState> {
  const out: Record<string, PropValueState> = {};
  for (const p of usages) {
    switch (p.tier) {
      case "written":
        out[p.name] =
          "valueSet" in p
            ? { tier: "written", valueSet: p.valueSet }
            : { tier: "written", value: p.value };
        break;
      case "reference":
        out[p.name] = { tier: "reference", ref: p.ref };
        break;
      case "dynamic":
        out[p.name] = { tier: "dynamic" };
        break;
    }
  }
  return out;
}
