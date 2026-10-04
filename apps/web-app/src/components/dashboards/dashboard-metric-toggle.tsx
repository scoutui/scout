"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardMetric } from "@scoutui/web-shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Switching between count and share needs a server re-projection (share is
 * normalised differently), so the toggle writes `?metric=` to the URL and the server
 * page re-renders. The saved chart is not changed.
 */
export function DashboardMetricToggle({ metric }: { metric: DashboardMetric }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setMetric = (next: string) => {
    if (next !== "count" && next !== "share") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("metric", next);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <ToggleGroup
      value={[metric]}
      onValueChange={(v) => {
        if (v[0]) setMetric(v[0]);
      }}
      variant="outline"
      size="sm"
      multiple={false}
      aria-label="Metric"
    >
      <ToggleGroupItem value="count">Uses</ToggleGroupItem>
      <ToggleGroupItem value="share">% of uses</ToggleGroupItem>
    </ToggleGroup>
  );
}
