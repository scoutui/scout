"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ellipsis } from "lucide-react";
import type { ChartVisibility } from "@scoutui/web-shared";
import { setDashboardVisibility } from "@/app/charts/dashboard-actions";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A saved chart's "⋯" menu: Duplicate for people who can make charts, and sharing for people who can change the chart,
 * given its `visibility`.
 */
export function ChartMenu({ id, canDuplicate, visibility }: { id: string; canDuplicate: boolean; visibility: ChartVisibility | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const share = (next: ChartVisibility) =>
    start(async () => {
      setError(null);
      const res = await setDashboardVisibility(id, next);
      if (res.ok) router.refresh();
      else setError(actionErrorMessage(res.error, "change who can see this chart", "Couldn't change who can see the chart. Try again."));
    });

  return (
    <span className="inline-flex items-center gap-2">
      <output className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground empty:hidden"}>
        {error}
      </output>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {visibility === "private" ? (
            <DropdownMenuItem disabled={pending} onClick={() => share("everyone")}>Share with everyone</DropdownMenuItem>
          ) : visibility === "everyone" ? (
            <DropdownMenuItem disabled={pending} onClick={() => share("private")}>Make private</DropdownMenuItem>
          ) : null}
          {canDuplicate ? (
            <DropdownMenuLinkItem closeOnClick render={<Link href={`/charts/new?from=${encodeURIComponent(id)}`} />}>
              Duplicate
            </DropdownMenuLinkItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
