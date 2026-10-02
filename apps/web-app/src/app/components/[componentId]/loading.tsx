import { TableSkeleton } from "@/components/ui/table-skeleton";

export default function ComponentDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="h-9 w-64 animate-pulse motion-reduce:animate-none rounded-md bg-muted/40" />
        <div className="h-4 w-80 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/30" />
        <div className="h-2 w-56 animate-pulse motion-reduce:animate-none rounded-full bg-muted/30" />
      </div>
      <TableSkeleton rows={5} columns={5} />
    </div>
  );
}
