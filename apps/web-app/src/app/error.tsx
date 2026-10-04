"use client";
import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-16 sm:px-8 lg:px-10">
      <EmptyState
        icon={<CircleX className="size-6 text-status-err" />}
        title="Couldn't load this page."
        description="Try again, or reload the page."
        action={
          <Button variant="ghost" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
