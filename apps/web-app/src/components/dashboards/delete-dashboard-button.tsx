"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteDashboard } from "@/app/charts/dashboard-actions";
import { actionErrorMessage } from "@/lib/action-error";

/** Inline two-step delete (no modal): a quiet "Delete" expands to confirm/cancel. */
export function DeleteDashboardButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteDashboard(id);
            if (res.ok) router.push("/charts");
            else setError(actionErrorMessage(res.error, "delete this chart", "Couldn't delete the chart. Try again."));
          })
        }
      >
        {pending ? "Deleting…" : "Delete chart"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
