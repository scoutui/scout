"use client";
import { type ReactNode, useEffect, useId, useRef, useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { removeScan } from "@/app/repos/repo-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { actionErrorMessage } from "@/lib/action-error";
import { DeleteRepoDialog } from "./delete-repo-dialog";

const MENU_ITEM = "text-xs text-destructive data-highlighted:text-destructive";

/**
 * The end of a scan history row for Admins: `children` (the row's View scan link) and a "⋯" menu. Remove scan swaps
 * them for a confirm in the row. On a repo's only scan the menu offers Delete repo… instead.
 */
export function ScanRowActions({ repoId, scanId, scanCount, children }: {
  repoId: string; scanId: string; scanCount: number; children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const removeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const promptId = useId();

  useEffect(() => {
    if (confirming) removeRef.current?.focus();
    else if (restoreFocus.current) triggerRef.current?.focus();
    restoreFocus.current = false;
  }, [confirming]);

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await removeScan(repoId, scanId);
      if (!result.ok) setError(actionErrorMessage(result.error, "remove scans", "Couldn't remove the scan. Try again."));
    });
  };

  const cancel = () => {
    setError(null);
    restoreFocus.current = true;
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-2 whitespace-nowrap max-sm:flex-wrap">
        {error
          ? <span id={promptId} role="alert" className="text-xs whitespace-normal text-destructive">{error}</span>
          : <span id={promptId} className="text-xs">Remove this scan?</span>}
        <div className="flex items-center gap-2">
          <Button ref={removeRef} variant="destructive" size="sm" disabled={pending} aria-describedby={promptId} onClick={remove}>
            Remove
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  const onlyScan = scanCount === 1;
  return (
    <div className="flex items-center justify-end gap-3">
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button ref={triggerRef} variant="ghost" size="icon-xs" aria-label="Scan actions" className="text-muted-foreground" />}>
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36 text-xs" finalFocus={onlyScan ? undefined : false}>
          {onlyScan ? (
            <DropdownMenuItem className={MENU_ITEM} onClick={() => setDeleting(true)}>Delete repo…</DropdownMenuItem>
          ) : (
            <DropdownMenuItem className={MENU_ITEM} onClick={() => setConfirming(true)}>Remove scan</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onlyScan ? <DeleteRepoDialog repoId={repoId} scanCount={scanCount} open={deleting} onOpenChange={setDeleting} /> : null}
    </div>
  );
}
