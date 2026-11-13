"use client";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";

export type RepoTab = "components" | "adoption";

const parseTab = (q: string): RepoTab => (q === "adoption" ? "adoption" : "components");
const serializeTab = (tab: RepoTab) => (tab === "components" ? "" : tab);

function Count({ n }: { n: number | null | undefined }) {
  if (n === null || n === undefined) return null;
  return <span className="text-xs tabular-nums text-muted-foreground">{n.toLocaleString()}</span>;
}

export function RepoTabs({
  components,
  adoption,
  componentCount,
  adoptionCount,
}: {
  components: ReactNode;
  adoption: ReactNode;
  componentCount?: number | null;
  adoptionCount?: number | null;
}) {
  const [tab, setTab] = useQuerySyncedState(parseTab, serializeTab, "tab");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as RepoTab)}>
      <TabsList variant="line">
        <TabsTrigger value="components">Components<Count n={componentCount} /></TabsTrigger>
        <TabsTrigger value="adoption">Adoption<Count n={adoptionCount} /></TabsTrigger>
      </TabsList>
      {/* Panels are not Tab stops: their focusable content (search, links) handles focus. */}
      <TabsContent value="components" tabIndex={-1}>{components}</TabsContent>
      <TabsContent value="adoption" tabIndex={-1}>{adoption}</TabsContent>
    </Tabs>
  );
}
