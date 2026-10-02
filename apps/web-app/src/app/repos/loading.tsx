import { TableSkeleton } from "@/components/ui/table-skeleton";

export default function ReposLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="h-8 w-24 animate-pulse motion-reduce:animate-none rounded-md bg-muted/40" />
        <div className="h-4 w-48 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/30" />
      </div>
      <TableSkeleton rows={8} columns={4} />
    </div>
  );
}
