"use client";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteRepoDialog } from "./delete-repo-dialog";

/** The repo header's "⋯" menu for Admins. */
export function RepoActionsMenu({ repoId, scanCount }: { repoId: string; scanCount: number }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Repo actions" className="text-muted-foreground" />}>
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40 text-xs">
          <DropdownMenuItem className="text-xs text-destructive data-highlighted:text-destructive" onClick={() => setDeleting(true)}>
            Delete repo…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteRepoDialog repoId={repoId} scanCount={scanCount} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
