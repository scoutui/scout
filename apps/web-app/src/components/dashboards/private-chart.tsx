import type { ReactElement } from "react";
import type { Dashboard } from "@scoutui/web-shared";
import { EmptyState } from "@/components/ui/empty-state";

/** What someone who can't open a private chart sees instead of it. */
export function privateChart({ createdBy, creatorRemoved }: Pick<Dashboard, "createdBy" | "creatorRemoved">): ReactElement {
  return (
    <EmptyState
      titleAs="h1"
      title="This chart is private."
      description={`Ask ${createdBy !== null && !creatorRemoved ? createdBy : "an Admin"} to share it with everyone.`}
    />
  );
}
