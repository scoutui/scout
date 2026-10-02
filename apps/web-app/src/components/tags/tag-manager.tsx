"use client";
import { useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { Tag, TagRule } from "@scoutui/web-shared";
import { tagMatchesPackage } from "@scoutui/web-shared/client";
import { saveTag, deleteTag } from "@/app/packages/tag-actions";
import { actionErrorMessage } from "@/lib/action-error";
import { CHART_SERIES_PALETTE, paletteToken, tagColourName } from "@/lib/chart-palette";
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

export function splitPatterns(raw: string): TagRule {
  const rule: TagRule = { glob: [], exact: [] };
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const entry = part.trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    (entry.includes("*") ? rule.glob : rule.exact).push(entry);
  }
  return rule;
}

export function packageCount(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "package" : "packages"}`;
}

/** Ids of the tag table's column headers, which also label the form's fields. */
export const TAG_COLUMN_ID = {
  name: "tags-col-name",
  colour: "tags-col-colour",
  packages: "tags-col-packages",
} as const;

/** The tag table's columns. From md up, the form row lays its fields out on the same widths. */
export function TagTableColumns() {
  return (
    <colgroup>
      <col className="w-28 md:w-40" />
      <col className="w-0 md:w-28" />
      <col />
      <col className="w-24 md:w-32" />
      <col className="w-12" />
    </colgroup>
  );
}

const FORM_GRID = "md:grid md:grid-cols-[10rem_7rem_minmax(0,1fr)_8rem_3rem]";

export function TagSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: paletteToken(color) }}
    />
  );
}

const FIELD = "flex min-w-0 flex-col gap-1.5 md:px-3";
const SMALL_LABEL = "text-label text-muted-foreground md:hidden";

export function TagEditor({
  tag,
  allTags,
  packageNames,
  onDone,
}: {
  tag?: Tag;
  allTags: Tag[];
  packageNames: string[];
  onDone: () => void;
}) {
  const [name, setName] = useState(tag?.value ?? "");
  const [color, setColor] = useState(tag?.color ?? nextTagColor(allTags));
  const [packages, setPackages] = useState(tag ? [...tag.rule.exact, ...tag.rule.glob].join("\n") : "");
  const [nameMissing, setNameMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const deleteRef = useRef<HTMLButtonElement>(null);

  const rule = splitPatterns(packages);
  const draft: Tag = { id: tag?.id ?? "", value: name.trim(), category: "library", color, rule };
  const matches = packageNames.filter((n) => tagMatchesPackage(draft, n));

  function submit() {
    const value = name.trim();
    setError(null);
    if (!value) {
      setNameMissing(true);
      return;
    }
    startTransition(async () => {
      const res = await saveTag({
        ...(tag ? { id: tag.id } : {}),
        value,
        category: "library",
        color,
        rule,
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
    <tr>
      <td colSpan={5} className="p-0">
        <div className={cn("flex flex-col gap-4 p-3 md:items-start md:gap-x-0 md:gap-y-3 md:px-0", FORM_GRID)}>
          <div className={FIELD}>
            <label htmlFor="tag-name" className={SMALL_LABEL}>
              Name
            </label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameMissing(false);
              }}
              aria-labelledby={TAG_COLUMN_ID.name}
              aria-describedby={nameMissing ? "tag-name-error" : undefined}
              aria-invalid={nameMissing || undefined}
              className="h-8 font-mono text-xs md:text-xs"
              autoFocus
            />
            {nameMissing ? (
              <p id="tag-name-error" role="alert" className="text-xs text-destructive">
                Enter a name.
              </p>
            ) : null}
          </div>

          <div className={FIELD}>
            <span aria-hidden className={SMALL_LABEL}>
              Colour
            </span>
            <RadioGroup
              value={color}
              onValueChange={(v) => setColor(v as string)}
              aria-labelledby={TAG_COLUMN_ID.colour}
              className="flex flex-wrap gap-1.5 md:grid md:gap-1"
            >
              {TAG_PALETTE.map((c) => (
                <Radio.Root
                  key={c}
                  value={c}
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors duration-150 ease-out outline-none not-data-checked:hover:bg-muted not-data-checked:hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:selected data-checked:text-foreground motion-reduce:transition-none"
                >
                  <TagSwatch color={c} />
                  {tagColourName(c)}
                </Radio.Root>
              ))}
            </RadioGroup>
          </div>

          <div className={FIELD}>
            <label htmlFor="tag-packages" className={SMALL_LABEL}>
              Packages
            </label>
            <textarea
              id="tag-packages"
              value={packages}
              onChange={(e) => setPackages(e.target.value)}
              rows={3}
              aria-labelledby={TAG_COLUMN_ID.packages}
              aria-describedby="tag-packages-hint"
              className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <p id="tag-packages-hint" className="text-[0.6875rem] text-muted-foreground">
              One package name or pattern per line. <span className="font-mono">*</span> matches anything.
            </p>
          </div>

          <p aria-live="polite" className="min-w-0 text-[0.8125rem] leading-5 tabular-nums md:col-span-2 md:px-3 md:pt-1.5">
            {matches.length === 0 ? (
              "Matches no scanned package"
            ) : (
              <>
                {`Matches ${packageCount(matches.length)}: `}
                <span className="font-mono text-xs wrap-anywhere text-muted-foreground">
                  {matches.slice(0, 4).join(", ")}
                </span>
                {matches.length > 4 ? ", …" : null}
              </>
            )}
          </p>

          {error ? (
            <p role="alert" className="text-xs text-destructive md:col-span-full md:px-3">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-full md:px-3">
            {tag ? (
              <div className="flex flex-wrap items-center gap-2">
                {confirmingDelete ? (
                  <span id="tag-delete-prompt" className="text-[0.8rem]">
                    {`Delete ${tag.value}? Charts that use it lose that line.`}
                  </span>
                ) : null}
                <Button
                  ref={deleteRef}
                  variant={confirmingDelete ? "destructive" : "ghost"}
                  size="sm"
                  onClick={confirmingDelete ? remove : () => setConfirmingDelete(true)}
                  disabled={pending}
                  aria-describedby={confirmingDelete ? "tag-delete-prompt" : undefined}
                  className={confirmingDelete ? undefined : "text-muted-foreground hover:text-destructive"}
                >
                  {confirmingDelete ? null : <Trash2 />}
                  Delete
                </Button>
                {confirmingDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setConfirmingDelete(false);
                      deleteRef.current?.focus();
                    }}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={pending}>
                {tag ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
