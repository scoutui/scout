"use client";
import { useState, useTransition } from "react";
import { TagIcon } from "lucide-react";
import { tagMatchesPackage, type Tag } from "@scoutui/web-shared/client";
import { quickTagPackage } from "@/app/packages/tag-actions";
import { actionErrorMessage } from "@/lib/action-error";
import { paletteToken } from "@/lib/chart-palette";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Row-level quick-tag affordance. Lists every tag with a check reflecting
 * whether `packageName` is in that tag's `exact` list; toggling routes through
 * `quickTagPackage`, which `revalidatePath`s so the row's chips refresh.
 */
export function QuickTag({
  packageName,
  allTags,
}: {
  packageName: string;
  allTags: Tag[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (allTags.length === 0) return null;

  function toggle(tag: Tag, add: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await quickTagPackage(tag.id, packageName, add);
      if (!res.ok) {
        setError(
          res.error === "unknown_tag"
            ? "That tag no longer exists."
            : actionErrorMessage(res.error, "change tags", "Couldn't update the tag. Try again."),
        );
      }
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={pending}
            aria-label={`Tag ${packageName}`}
            className="text-muted-foreground"
          >
            <TagIcon />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-60 gap-0 p-0">
        <div className="px-2.5 py-2">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Tag this package
          </span>
        </div>
        <ul className="max-h-72 overflow-y-auto border-t py-1">
          {allTags.map((tag) => {
            // The tick shows the effective state (exact list or glob rule),
            // matching the chips resolveTags renders. A glob-matched tag can't
            // be removed here (dropping it from `exact` changes nothing), so it
            // shows checked and disabled.
            const inExact = tag.rule.exact.includes(packageName);
            const viaRule = !inExact && tagMatchesPackage(tag, packageName);
            return (
              <li key={tag.id}>
                <button
                  type="button"
                  disabled={pending || viaRule}
                  onClick={() => toggle(tag, !inExact)}
                  title={viaRule ? `Applied by this tag's glob rule (${tag.rule.glob.join(", ")})` : undefined}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                >
                  <Checkbox checked={inExact || viaRule} tabIndex={-1} aria-hidden />
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: paletteToken(tag.color) }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{tag.value}</span>
                  {viaRule ? <span className="shrink-0 text-[0.6875rem] text-muted-foreground">via rule</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="border-t px-2.5 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
