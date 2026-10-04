import type { ReactElement } from "react";
import { EmptyState } from "@/components/ui/empty-state";

/** What someone who can't open a private chart sees instead of it. */
export function privateChart(createdBy: string | null): ReactElement {
  return (
    <EmptyState
      titleAs="h1"
      title="This chart is private."
      description={`Ask ${createdBy ?? "an Admin"} to share it with everyone.`}
    />
  );
}
