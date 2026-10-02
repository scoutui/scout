"use client";
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Tag } from "@scoutui/web-shared";
import { tagMatchesPackage } from "@scoutui/web-shared/client";
import { packageCount, TAG_COLUMN_ID, TagEditor, TagSwatch, TagTableColumns } from "./tag-manager";
import { Button } from "@/components/ui/button";
import { tagColourName } from "@/lib/chart-palette";
import { cn } from "@/lib/utils";

const TH = "h-9 bg-muted px-3 text-left text-label text-muted-foreground";
const CELL = "px-3 py-2.5 align-middle";

const editButtonId = (tagId: string) => `edit-tag-${tagId}`;

export function TagsPanel({ allTags, packageNames }: { allTags: Tag[]; packageNames: string[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const addTagRef = useRef<HTMLButtonElement>(null);
  /** Set when a tag form closes: the tag whose Edit button takes focus, or undefined for Add tag. */
  const [focusAfterClose, setFocusAfterClose] = useState<{ tagId: string | undefined } | null>(null);

  useEffect(() => {
    if (!focusAfterClose) return;
    setFocusAfterClose(null);
    const edit = focusAfterClose.tagId ? document.getElementById(editButtonId(focusAfterClose.tagId)) : null;
    (edit ?? addTagRef.current)?.focus();
  }, [focusAfterClose]);

  function openNew() {
    setCreating(true);
    setEditingId(null);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setCreating(false);
  }

  function closeForm(focusTagId?: string) {
    setCreating(false);
    setEditingId(null);
    setFocusAfterClose({ tagId: focusTagId });
  }

  return (
    <>
      <div className="flex items-baseline gap-2">
        <h2 id="tags-title" className="text-base font-medium">
          Tags
        </h2>
        {allTags.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {allTags.length.toLocaleString()} {allTags.length === 1 ? "tag" : "tags"}
          </span>
        ) : null}
        <Button
          ref={addTagRef}
          variant="outline"
          size="sm"
          onClick={openNew}
          disabled={creating || editingId !== null}
          className="ml-auto self-center"
        >
          <Plus />
          Add tag
        </Button>
      </div>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Group packages by library for adoption charts and filtering.
      </p>

      {allTags.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <div className="panel overflow-hidden">
          <table aria-labelledby="tags-title" className="w-full table-fixed text-sm">
            <TagTableColumns />
            <thead>
              <tr className="border-b border-border">
                <th scope="col" id={TAG_COLUMN_ID.name} className={TH}>
                  Name
                </th>
                <th scope="col" id={TAG_COLUMN_ID.colour} className={cn(TH, "px-0 md:px-3")}>
                  <span className="sr-only md:not-sr-only">Colour</span>
                </th>
                <th scope="col" id={TAG_COLUMN_ID.packages} className={TH}>
                  Packages
                </th>
                <th scope="col" className={cn(TH, "px-0 md:px-3")}>
                  <span className="sr-only md:not-sr-only">Matches</span>
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {creating ? (
                <TagEditor
                  allTags={allTags}
                  packageNames={packageNames}
                  onDone={() => closeForm()}
                  onDeleted={() => closeForm()}
                />
              ) : null}
              {allTags.map((tag) =>
                editingId === tag.id ? (
                  <TagEditor
                    key={tag.id}
                    tag={tag}
                    allTags={allTags}
                    packageNames={packageNames}
                    onDone={() => closeForm(tag.id)}
                    onDeleted={() => closeForm()}
                  />
                ) : (
                  <TagRow key={tag.id} tag={tag} packageNames={packageNames} onEdit={() => openEdit(tag.id)} />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TagRow({ tag, packageNames, onEdit }: { tag: Tag; packageNames: string[]; onEdit: () => void }) {
  const matches = packageNames.filter((n) => tagMatchesPackage(tag, n));
  const matchText =
    matches.length > 0 ? (
      <span className="tabular-nums" title={matches.join(", ")}>
        {packageCount(matches.length)}
      </span>
    ) : (
      <span className="text-muted-foreground">No scanned package</span>
    );
  return (
    <tr className="transition-colors duration-150 ease-out hover:bg-secondary dark:hover:bg-accent motion-reduce:transition-none">
      <td className={CELL}>
        <span className="flex items-center gap-2">
          <TagSwatch color={tag.color} className="md:hidden" />
          <span className="min-w-0 font-mono text-xs wrap-anywhere">{tag.value}</span>
        </span>
      </td>
      <td className={cn(CELL, "px-0 md:px-3")}>
        <span className="flex items-center gap-2 text-[0.8125rem]">
          <TagSwatch color={tag.color} className="hidden md:inline-block" />
          <span className="sr-only md:not-sr-only">{tagColourName(tag.color)}</span>
        </span>
      </td>
      <td className={CELL}>
        <span className="flex flex-wrap gap-x-3.5 gap-y-0.5 font-mono text-xs">
          {[...tag.rule.exact, ...tag.rule.glob].map((entry) => (
            <span key={entry} className="min-w-0 wrap-anywhere">
              {entry}
            </span>
          ))}
        </span>
        <span aria-hidden className="mt-1 block text-[0.8125rem] md:hidden">
          {matchText}
        </span>
      </td>
      <td className={cn(CELL, "px-0 text-[0.8125rem] md:px-3")}>
        <span className="sr-only md:not-sr-only">{matchText}</span>
      </td>
      <td className={cn(CELL, "text-right")}>
        <Button
          id={editButtonId(tag.id)}
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          aria-label={`Edit ${tag.value}`}
          title="Edit"
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil strokeWidth={1.5} className="size-3.5" />
        </Button>
      </td>
    </tr>
  );
}
