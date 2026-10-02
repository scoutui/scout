"use client";
import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function PackagesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      icon={<CircleX className="size-6 text-status-err" />}
      title="Something went wrong."
      description="Could not load packages. You can try again or refresh the page."
      action={
        <Button variant="ghost" size="sm" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
