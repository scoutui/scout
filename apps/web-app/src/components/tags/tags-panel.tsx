"use client";
import { useState } from "react";
import { Edit2, Plus } from "lucide-react";
import type { Tag } from "@scoutui/web-shared";
import { TagEditor } from "./tag-manager";
import { Button } from "@/components/ui/button";
import { paletteToken } from "@/lib/chart-palette";

/**
 * Inline tag-management panel for /governance: the full tag list, with Edit
 * and New tag opening TagEditor inline. TagEditor makes the saveTag /
 * deleteTag calls.
 */
export function TagsPanel({ allTags }: { allTags: Tag[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function openNew() {
    setCreating(true);
    setEditingId(null);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setCreating(false);
  }

  function closeForm() {
    setCreating(false);
    setEditingId(null);
  }

  const isEmpty = allTags.length === 0 && !creating;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Group packages by library for adoption charts and filtering.
        </p>
        <Button variant="outline" size="sm" onClick={openNew} disabled={creating}>
          <Plus />
          New tag
        </Button>
      </div>

      {/* Inline create form */}
      {creating && (
        <div className="panel p-4">
          <h3 className="mb-3 text-sm font-medium">New tag</h3>
          <TagEditor allTags={allTags} onDone={closeForm} />
        </div>
      )}

      {/* Tag list */}
      {isEmpty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No tags yet. Group packages by library with a new tag.
        </p>
      ) : (
        allTags.length > 0 && (
          <ul className="panel divide-y divide-border overflow-hidden">
            {allTags.map((tag) => {
              const ruleCount = tag.rule.glob.length + tag.rule.exact.length;
              return (
                <li key={tag.id}>
                  {editingId === tag.id ? (
                    <div className="p-4">
                      <h3 className="mb-3 text-sm font-medium">Edit tag</h3>
                      <TagEditor
                        tag={tag}
                        allTags={allTags}
                        onDone={closeForm}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1 flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: paletteToken(tag.color) }}
                        />
                        <span className="min-w-0 truncate font-mono text-xs text-foreground">
                          {tag.value}
                        </span>
                      </div>

                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {ruleCount.toLocaleString()} rule{ruleCount === 1 ? "" : "s"}
                      </span>

                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => openEdit(tag.id)}
                        aria-label="Edit tag"
                      >
                        <Edit2 />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}
