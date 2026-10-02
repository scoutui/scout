import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <EmptyState
      icon={<SearchX className="size-6" />}
      title="Page not found."
      description="The repo, package or chart this link points to may have been renamed or deleted."
      action={
        <Link
          href="/repos"
          className="text-sm text-foreground underline-offset-4 hover:underline"
        >
          Back to repos
        </Link>
      }
    />
  );
}
