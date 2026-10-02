"use client";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";

export type RepoTab = "components" | "adoption";

const parseTab = (q: string): RepoTab => (q === "adoption" ? "adoption" : "components");
const serializeTab = (tab: RepoTab) => (tab === "components" ? "" : tab);

export function RepoTabs({
  components,
  adoption,
}: {
  components: ReactNode;
  adoption: ReactNode;
}) {
  const [tab, setTab] = useQuerySyncedState(parseTab, serializeTab, "tab");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as RepoTab)}>
      <TabsList variant="line">
        <TabsTrigger value="components">Components</TabsTrigger>
        <TabsTrigger value="adoption">Adoption</TabsTrigger>
      </TabsList>
      {/* Panels are not Tab stops: their focusable content (search, links) handles focus. */}
      <TabsContent value="components" tabIndex={-1}>{components}</TabsContent>
      <TabsContent value="adoption" tabIndex={-1}>{adoption}</TabsContent>
    </Tabs>
  );
}
