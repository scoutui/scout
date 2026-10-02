import { cn } from "@/lib/utils"

// Column widths cycle across cells to mimic varied real content.
const COL_WIDTHS = ["w-2/5", "w-1/4", "w-1/6", "w-1/6", "w-1/8"] as const

interface TableSkeletonProps {
  rows?: number
  columns?: number
  className?: string
  // Adds a placeholder for the controls strip the data views show above the
  // table (packages, components, repo).
  toolbar?: boolean
}

// Stable string keys, so biome's noArrayIndexKey rule passes. The slots are
// never reordered.
function columnKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `col-${i}`)
}

function rowKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `row-${i}`)
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  className,
  toolbar = false,
}: TableSkeletonProps) {
  const hKeys = columnKeys(columns)
  const rKeys = rowKeys(rows)
  const cKeys = columnKeys(columns)

  return (
    <div className={cn("panel overflow-hidden", className)} aria-hidden>
      {toolbar ? (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <div className="h-8 w-64 animate-pulse motion-reduce:animate-none rounded-lg bg-muted/50" />
          <div className="h-8 w-20 animate-pulse motion-reduce:animate-none rounded-lg bg-muted/50" />
          <div className="ml-auto h-3 w-24 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/40" />
        </div>
      ) : null}
      {/* Header row */}
      <div className="flex items-center gap-4 border-b px-3 py-2.5">
        {hKeys.map((k, i) => (
          <div
            key={k}
            className={cn(
              "h-3 rounded-sm bg-muted/60 animate-pulse motion-reduce:animate-none",
              COL_WIDTHS[i % COL_WIDTHS.length],
            )}
          />
        ))}
      </div>

      {/* Body rows */}
      {rKeys.map((rk, rowIdx) => (
        <div
          key={rk}
          className="flex items-center gap-4 border-b px-3 py-2 last:border-0"
        >
          {cKeys.map((ck, colIdx) => (
            <div
              key={`${rk}-${ck}`}
              className={cn(
                "h-3.5 rounded-sm bg-muted/40 animate-pulse motion-reduce:animate-none",
                COL_WIDTHS[colIdx % COL_WIDTHS.length],
              )}
              style={{ animationDelay: `${(rowIdx * columns + colIdx) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
