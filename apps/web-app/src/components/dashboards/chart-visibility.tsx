import { Lock, type LucideIcon, Users } from "lucide-react";
import type { ChartVisibility } from "@scoutui/web-shared";

/** Each visibility's name and icon, on a chart's page and in the chart builder. */
export const VISIBILITY: Record<ChartVisibility, { label: string; icon: LucideIcon }> = {
  private: { label: "Private", icon: Lock },
  everyone: { label: "Shared", icon: Users },
};

/** Who can see a chart. `mine` is whether the reader made it. */
export function visibilityTitle(visibility: ChartVisibility, mine: boolean): string {
  if (visibility === "everyone") return "Everyone signed in can see this chart.";
  return mine ? "Only you and Admins can see this chart." : "Only its creator and Admins can see this chart.";
}

/** A saved chart's visibility, for the meta line under its name. */
export function ChartVisibilityLabel({ visibility, mine }: { visibility: ChartVisibility; mine: boolean }) {
  const { label, icon: Icon } = VISIBILITY[visibility];
  return (
    <span className="inline-flex items-center gap-1" title={visibilityTitle(visibility, mine)}>
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}
