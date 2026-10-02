"use client";
import { useState, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import type { Tag } from "@scoutui/web-shared";
import { saveTag, deleteTag } from "@/app/packages/tag-actions";
import { actionErrorMessage } from "@/lib/action-error";
import { CHART_SERIES_PALETTE, paletteToken } from "@/lib/chart-palette";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Tag swatches are the shared cohort palette (`chart-palette`), which excludes
// the status hues, so a tag dot is never misread as a status. A tag's chart line
// keeps the tag's colour unless another line on the chart already has it or one
// like it.
const TAG_PALETTE = CHART_SERIES_PALETTE;

function nextTagColor(existing: Tag[]): string {
  const used = new Set(existing.map((t) => t.color));
  const unused = TAG_PALETTE.find((c) => !used.has(c));
  // Every swatch is used: fall back round-robin. The index is always in range
  // (modulo over a non-empty tuple), but narrow it for the strict index check.
  return unused ?? TAG_PALETTE[existing.length % TAG_PALETTE.length] ?? TAG_PALETTE[0];
}

/** Split a textarea value into a trimmed, de-duplicated string list. */
function parseList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const v = part.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

export function TagEditor({
  tag,
  allTags,
  onDone,
}: {
  tag?: Tag;
  allTags: Tag[];
  onDone: () => void;
}) {
  const [value, setValue] = useState(tag?.value ?? "");
  const [color, setColor] = useState(tag?.color ?? nextTagColor(allTags));
  const [glob, setGlob] = useState((tag?.rule.glob ?? []).join("\n"));
  const [exact, setExact] = useState((tag?.rule.exact ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("A tag needs a value.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveTag({
        ...(tag ? { id: tag.id } : {}),
        value: trimmed,
        category: "library",
        color,
        rule: { glob: parseList(glob), exact: parseList(exact) },
      });
      if (res.ok) onDone();
      else setError(actionErrorMessage(res.error, "save this tag", "Couldn't save the tag. Try again."));
    });
  }

  function remove() {
    if (!tag) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteTag(tag.id);
      if (res.ok) onDone();
      else setError(actionErrorMessage(res.error, "delete this tag", "Couldn't delete the tag. Try again."));
    });
  }

  return (
    <div className="flex flex-col gap-2.5 bg-muted/30 px-2.5 py-2.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value (e.g. core)"
        className="font-mono text-xs"
        autoFocus
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {TAG_PALETTE.map((c) => {
          const active = c === color;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Use color ${c}`}
              aria-pressed={active}
              className={cn(
                "flex size-5 items-center justify-center rounded-full ring-1 ring-foreground/10 transition-transform",
                active && "ring-2 ring-ring"
              )}
              style={{ backgroundColor: paletteToken(c) }}
            >
              {active && <Check className="size-3 text-white" />}
            </button>
          );
        })}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Glob patterns
        </span>
        <textarea
          value={glob}
          onChange={(e) => setGlob(e.target.value)}
          placeholder={"@scope/lib-*\none per line or comma-separated"}
          rows={2}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Exact names
        </span>
        <textarea
          value={exact}
          onChange={(e) => setExact(e.target.value)}
          placeholder={"legacy-design-system\none per line or comma-separated"}
          rows={2}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        {tag ? (
          <Button
            variant="destructive"
            size="xs"
            onClick={remove}
            disabled={pending}
          >
            <Trash2 />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button size="xs" onClick={submit} disabled={pending}>
            {tag ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
