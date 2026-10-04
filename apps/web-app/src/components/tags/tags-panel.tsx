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
const CELL = "px-3 py-2.5 align-middle max-md:py-0";

const editButtonId = (tagId: string) => `edit-tag-${tagId}`;

export function TagsPanel({
  allTags,
  packageNames,
}: {
  allTags: Tag[];
  /** Null while scan results are rebuilding. */
  packageNames: string[] | null;
}) {
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
          <table aria-labelledby="tags-title" className="w-full table-fixed text-sm max-md:block">
            <TagTableColumns />
            <thead className="max-md:sr-only">
              <tr className="border-b border-border">
                <th scope="col" id={TAG_COLUMN_ID.name} className={TH}>
                  Name
                </th>
                <th scope="col" id={TAG_COLUMN_ID.packages} className={TH}>
                  Packages
                </th>
                <th scope="col" className={TH}>
                  Matches
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border max-md:block">
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

function TagRow({ tag, packageNames, onEdit }: { tag: Tag; packageNames: string[] | null; onEdit: () => void }) {
  const matches = packageNames?.filter((n) => tagMatchesPackage(tag, n));
  const matchText = !matches ? (
    <span className="text-muted-foreground">No data</span>
  ) : matches.length > 0 ? (
    <span className="tabular-nums" title={matches.join(", ")}>
      {packageCount(matches.length)}
    </span>
  ) : (
    <span className="text-muted-foreground">No scanned package</span>
  );
  return (
    <tr className="transition-colors duration-150 ease-out hover:bg-secondary max-md:grid max-md:grid-cols-[minmax(0,1fr)_3rem] max-md:items-center max-md:gap-y-1 max-md:py-2.5 dark:hover:bg-accent motion-reduce:transition-none">
      <td className={cn(CELL, "max-md:col-start-1 max-md:row-start-1")}>
        <span className="flex items-center gap-2">
          <TagSwatch color={tag.color} label={tagColourName(tag.color)} />
          <span className="min-w-0 font-mono text-xs wrap-anywhere">{tag.value}</span>
        </span>
      </td>
      <td className={cn(CELL, "max-md:col-span-full max-md:row-start-2")}>
        <TagPackages tag={tag} />
      </td>
      <td className={cn(CELL, "text-xs max-md:col-span-full max-md:row-start-3 max-md:text-muted-foreground")}>
        {matchText}
      </td>
      <td className={cn(CELL, "text-right max-md:col-start-2 max-md:row-start-1")}>
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

function TagPackages({ tag }: { tag: Tag }) {
  const [open, setOpen] = useState(false);
  const entries = [...tag.rule.exact, ...tag.rule.glob];
  const folds = entries.length >= 6;
  const hidden = entries.length - 4;
  return (
    <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5 font-mono text-xs">
      {(folds && !open ? entries.slice(0, 4) : entries).map((entry) => (
        <span key={entry} className="min-w-0 wrap-anywhere">
          {entry}
        </span>
      ))}
      {folds ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? undefined : `Show ${hidden.toLocaleString()} more packages in ${tag.value}`}
          onClick={() => setOpen(!open)}
          className="inline-flex h-5 cursor-pointer items-center rounded-sm border border-border px-2 font-sans text-xs leading-none whitespace-nowrap text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground motion-reduce:transition-none"
        >
          {open ? "Show fewer" : `+${hidden.toLocaleString()} more`}
        </button>
      ) : null}
    </span>
  );
}
