import type { TagRef } from "@scoutui/web-shared"

import { paletteToken } from "@/lib/chart-palette"
import { cn } from "@/lib/utils"

/**
 * A single tag chip. The tag's `color` is an authored hex, so it is a small dot
 * on the neutral chip rather than a tinted background, and the label's contrast
 * never depends on it. A hex that matches a palette swatch renders through
 * `paletteToken` as its theme token, with its dark-mode variant; a custom hex
 * renders as is.
 */
export function TagChip({
  tag,
  className,
}: {
  tag: TagRef
  className?: string
}) {
  return (
    <span
      aria-label={tag.category ? `${tag.category}: ${tag.value}` : tag.value}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-4xl border border-border bg-secondary px-2 py-0.5 font-mono text-xs font-medium whitespace-nowrap text-secondary-foreground",
        className
      )}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: paletteToken(tag.color) }}
      />
      {tag.value}
    </span>
  )
}

/**
 * A row of tag chips kept to one line, so a tag-dense row never grows the
 * table's row height: up to `max` chips, then a "+N" chip with the hidden
 * values in its title. Renders nothing when there are no tags.
 */
export function TagChips({ tags, max = 2 }: { tags: TagRef[]; max?: number }) {
  if (tags.length === 0) return null

  const visible = tags.slice(0, max)
  const hidden = tags.slice(max)

  return (
    <span className="inline-flex items-center gap-1">
      {visible.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {hidden.length > 0 ? (
        <span
          title={hidden.map((t) => t.value).join(", ")}
          aria-label={`${hidden.length} more: ${hidden.map((t) => t.value).join(", ")}`}
          className="inline-flex h-5 shrink-0 items-center rounded-4xl border border-border bg-secondary px-2 font-mono text-xs font-medium whitespace-nowrap text-muted-foreground"
        >
          +{hidden.length.toLocaleString()}
        </span>
      ) : null}
    </span>
  )
}
