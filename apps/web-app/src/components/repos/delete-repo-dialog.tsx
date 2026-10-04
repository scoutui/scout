"use client";
import { type FormEvent, useId, useState, useTransition } from "react";
import { deleteRepo } from "@/app/repos/repo-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/lib/action-error";

/** Asks for the repo's name before deleting it with all its scans. Deleting goes to the repos list. */
export function DeleteRepoDialog({ repoId, scanCount, open, onOpenChange }: {
  repoId: string; scanCount: number; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  const matches = typed === repoId;

  const changeOpen = (next: boolean) => {
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteRepo(repoId);
      if (result?.ok === false) setError(actionErrorMessage(result.error, "delete repos", "Couldn't delete the repo. Try again."));
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <DialogTitle>Delete <span className="font-mono">{repoId}</span>?</DialogTitle>
            <DialogDescription>
              {`This deletes the repo and its ${scanCount.toLocaleString()} ${scanCount === 1 ? "scan" : "scans"}. It comes back the next time a scan of it is uploaded.`}
            </DialogDescription>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm">
              Type <span className="font-mono">{repoId}</span> to confirm
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" size="sm" />}>Cancel</DialogClose>
            <Button type="submit" variant="destructive" size="sm" disabled={!matches || pending}>Delete repo</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
