"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Ellipsis } from "lucide-react";
import type { ChartVisibility, DashboardView } from "@scoutui/web-shared";
import { setDashboardVisibility } from "@/app/charts/dashboard-actions";
import { actionErrorMessage } from "@/lib/action-error";
import { chartExportTable, exportFileName, toCsv, toTsv } from "@/lib/chart-export";
import { hasFigure } from "@/lib/chart-figure";
import { chartPng } from "@/lib/chart-png";
import { visibleView } from "@/lib/dashboard-chart-data";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ShownChart, useChartExport } from "./chart-export-context";

/** How long "Image copied" and "Table copied" show. */
const COPIED_MS = 1800;
/** The UTF-8 byte order mark, written first in a downloaded CSV. */
const UTF8_BOM = "\uFEFF";
/** How long a download's file stays readable after its link is clicked. */
const DOWNLOAD_URL_MS = 60_000;

type ExportedChart = ShownChart & { title: string; drawn: DashboardView };

/**
 * A chart's "⋯" menu: its image and table for the chart on screen, in an Export submenu when `exportSubmenu` is set,
 * Duplicate for people who can make charts, and sharing for people who can change the chart, given its `visibility`.
 * It renders nothing when it has no items.
 */
export function ChartMenu({
  id,
  canDuplicate,
  visibility,
  exportSubmenu,
}: {
  id: string;
  canDuplicate: boolean;
  visibility: ChartVisibility | null;
  exportSubmenu: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const exported = useChartExport();
  const chart = useMemo<ExportedChart | null>(
    () =>
      exported && {
        ...exported.chart,
        title: exported.title,
        drawn: visibleView(exported.chart.config, exported.chart.view, exported.chart.range).view,
      },
    [exported],
  );

  const showCopied = (message: string) => {
    clearTimeout(copiedTimer.current);
    setError(null);
    setCopied(message);
    copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };
  const showError = (message: string) => {
    clearTimeout(copiedTimer.current);
    setCopied(null);
    setError(message);
  };

  const share = (next: ChartVisibility) =>
    start(async () => {
      setError(null);
      const res = await setDashboardVisibility(id, next);
      if (res.ok) router.refresh();
      else setError(actionErrorMessage(res.error, "change who can see this chart", "Couldn't change who can see the chart. Try again."));
    });

  const downloadPng = (shown: ExportedChart) => {
    setError(null);
    imageOf(shown).then(
      (blob) => save(blob, exportFileName(shown.title, "png")),
      () => showError("Couldn't make the image. Try again."),
    );
  };
  const copyImage = (shown: ExportedChart) =>
    navigator.clipboard.write([new ClipboardItem({ "image/png": imageOf(shown) })]).then(
      () => showCopied("Image copied"),
      () => showError("Couldn't copy the image. Try again."),
    );
  const downloadCsv = (shown: ExportedChart) => {
    setError(null);
    save(new Blob([UTF8_BOM, toCsv(chartExportTable(shown.config, shown.view, shown.range))], { type: "text/csv;charset=utf-8" }), exportFileName(shown.title, "csv"));
  };
  const copyTable = (shown: ExportedChart) =>
    navigator.clipboard.writeText(toTsv(chartExportTable(shown.config, shown.view, shown.range))).then(
      () => showCopied("Table copied"),
      () => showError("Couldn't copy the table. Try again."),
    );

  const sharing = visibility === "private" || visibility === "everyone";
  if (!chart && !sharing && !canDuplicate) return null;
  const image = chart !== null && hasFigure(chart.config, chart.drawn);
  const canCopyImage = image && typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
  const canCopyTable = chart !== null && typeof navigator.clipboard?.writeText === "function";
  const exportItems = chart ? (
    <>
      {image ? <DropdownMenuItem onClick={() => downloadPng(chart)}>Download PNG</DropdownMenuItem> : null}
      <DropdownMenuItem onClick={() => downloadCsv(chart)}>Download CSV</DropdownMenuItem>
      {canCopyImage ? <DropdownMenuItem onClick={() => copyImage(chart)}>Copy image</DropdownMenuItem> : null}
      {canCopyTable ? <DropdownMenuItem onClick={() => copyTable(chart)}>Copy table</DropdownMenuItem> : null}
    </>
  ) : null;

  return (
    <span className="inline-flex items-center gap-2">
      <output className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground empty:hidden"}>
        {error ?? copied}
      </output>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {exportItems && exportSubmenu ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>{exportItems}</DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            exportItems
          )}
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

function imageOf(shown: ExportedChart): Promise<Blob> {
  return chartPng({ title: shown.title, config: shown.config, view: shown.drawn, host: window.location.host, exportedAt: new Date() });
}

function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_MS);
}
