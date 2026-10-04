"use client";

import { useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { Input } from "@/components/ui/input";
import { movementParts } from "@/lib/scan-diff-view";
import { DeprecatedFilterChip } from "@/components/deprecated-filter-chip";
import { FacetedFilterBar, tagFacet, tagPills, type Facet, type FilterPill } from "@/components/faceted-filter-bar";
import { StatusFilterChip } from "@/components/status-filter-chip";
import { cn } from "@/lib/utils";
import {
  emptyFacets,
  isFiltering,
  KIND_LABEL,
  ORIGIN_DESCRIPTION,
  ORIGIN_LABEL,
  type FacetOptions,
  type FacetState,
  type KindValue,
  type OccurrenceOp,
  type OriginValue,
} from "@/lib/component-facets";

export function FilterBar({
  facets,
  onChange,
  options,
  resultCount,
  total,
  deprecatedTotal,
  diffShown,
  filtering,
  canEdit,
}: {
  facets: FacetState;
  onChange: (next: FacetState) => void;
  options: FacetOptions;
  resultCount: number;
  total: number;
  deprecatedTotal: number;
  /** While the changed view is active: its unfiltered size (`total`) and the
   *  shown rows' breakdown; null outside it. Unfiltered the count reads
   *  `29 changes`; narrowed by any other filter, `12 of 29 changes · 2 removed ·
   *  10 changed`, zero parts omitted. It replaces `N of M components` because
   *  removed rows come from the previous scan. */
  diffShown: { total: number; added: number; removed: number; changed: number } | null;
  /** Whether anything besides `changed` narrows the rows, i.e. whether the
   *  count reads `N of M`. `facets`, and every write through `onChange`, keep
   *  the real state. */
  filtering: boolean;
  canEdit: boolean;
}) {
  const diffParts = diffShown === null ? [] : movementParts(diffShown);
  const inkCount = (n: number) => <span className="font-medium text-foreground">{n.toLocaleString()}</span>;
  const setTags = (tags: string[]) => onChange({ ...facets, tags });
  const othersOn = diffShown === null && isFiltering({ ...facets, deprecated: null, changed: false });

  // Deprecation and "since previous scan" are statuses, not facets: each is a
  // StatusFilterChip beside the Filter menu.
  const facetList: Facet[] = [
    {
      key: "origin",
      label: "Origin",
      values: (["external", "local"] as const).map((o) => ({
        value: o,
        label: ORIGIN_LABEL[o],
        description: ORIGIN_DESCRIPTION[o],
        count: options.origin[o],
      })),
      selected: facets.origin ? [facets.origin] : [],
      onSelect: ([origin]) => onChange({ ...facets, origin: (origin as OriginValue | undefined) ?? null }),
      single: true,
    },
    {
      key: "kind",
      label: "Type",
      values: options.kinds.map((k) => ({ value: k.value, label: KIND_LABEL[k.value], count: k.count })),
      selected: facets.kinds,
      onSelect: (kinds) => onChange({ ...facets, kinds: kinds as KindValue[] }),
      dropsWithOneValue: true,
    },
    {
      key: "package",
      label: "Package",
      values: options.packages,
      selected: facets.packages,
      onSelect: (packages) => onChange({ ...facets, packages }),
      mono: true,
      searchPlaceholder: "Search packages…",
      empty: "No packages.",
    },
    tagFacet(options.tags, facets.tags, setTags, canEdit),
    {
      key: "occurrences",
      label: "Uses",
      picker: <OccurrencePicker facets={facets} onChange={onChange} />,
      active: facets.occurrences ? 1 : 0,
    },
  ];

  const pills: FilterPill[] = [
    ...(facets.origin
      ? [{ key: "origin", field: "origin", value: ORIGIN_LABEL[facets.origin].toLowerCase(), onRemove: () => onChange({ ...facets, origin: null }) }]
      : []),
    ...facets.kinds.map((k) => ({
      key: `kind:${k}`,
      field: "type",
      value: KIND_LABEL[k],
      onRemove: () => onChange({ ...facets, kinds: facets.kinds.filter((x) => x !== k) }),
    })),
    ...facets.packages.map((p) => ({
      key: `pkg:${p}`,
      field: "package",
      value: p,
      mono: true,
      onRemove: () => onChange({ ...facets, packages: facets.packages.filter((x) => x !== p) }),
    })),
    ...tagPills(options.tags, facets.tags, setTags),
    // Only `deprecated: false` gets a pill: `true` shows as the chip's pressed
    // state, while `false` arrives only from a pasted URL and needs a way to be
    // removed. `changed` needs none: its chip shows `true`, and `false` is the
    // empty state.
    ...(facets.deprecated === false
      ? [{ key: "deprecated", field: "deprecated", value: "no", onRemove: () => onChange({ ...facets, deprecated: null }) }]
      : []),
    ...(facets.occurrences
      ? [
          {
            key: "occurrences",
            field: "uses",
            value: `${occurrenceSymbol(facets.occurrences.op)} ${facets.occurrences.value.toLocaleString()}`,
            onRemove: () => onChange({ ...facets, occurrences: null }),
          },
        ]
      : []),
  ];

  return (
    <FacetedFilterBar
      search={{
        value: facets.text,
        onChange: (text) => onChange({ ...facets, text }),
        label: "Search components by name",
        placeholder: `Search ${total.toLocaleString()} components by name…`,
      }}
      chips={
        <>
          {options.deprecatedMax > 0 || facets.deprecated === true ? (
            <DeprecatedFilterChip
              count={options.deprecatedCount}
              maxCount={options.deprecatedMax}
              total={othersOn ? deprecatedTotal : undefined}
              active={facets.deprecated === true}
              onToggle={() => onChange({ ...facets, deprecated: facets.deprecated === true ? null : true })}
            />
          ) : null}
          {/* Labelled "since previous scan", not "changed": its count is every
              row the changed view shows, while the masthead's "N changed" counts
              only occurrence moves. */}
          {options.changedCount !== null ? (
            <StatusFilterChip
              icon={GitCompareArrows}
              tone="neutral"
              label="since previous scan"
              count={options.changedCount}
              maxCount={options.changedMax}
              active={facets.changed}
              onToggle={() => onChange({ ...facets, changed: !facets.changed })}
            />
          ) : null}
        </>
      }
      facets={facetList}
      count={
        diffShown !== null && filtering ? (
          <>
            {inkCount(resultCount)} of {changesLabel(diffShown.total)}
            {diffParts.map((p) => (
              <span key={p.word}>
                {" · "}
                {inkCount(p.n)} {p.word}
              </span>
            ))}
          </>
        ) : diffShown !== null ? (
          <>{changesLabel(diffShown.total)}</>
        ) : filtering ? (
          <>
            {inkCount(resultCount)} of {total.toLocaleString()} components
          </>
        ) : (
          <>{total.toLocaleString()} components</>
        )
      }
      pills={pills}
      onClearAll={() => onChange(emptyFacets())}
    />
  );
}

function changesLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "change" : "changes"}`;
}

function occurrenceSymbol(op: OccurrenceOp): string {
  return op === ">=" ? "≥" : op === "<=" ? "≤" : op;
}

const OCCURRENCE_PRESETS: { label: string; op: OccurrenceOp; value: number }[] = [
  { label: "≥ 10", op: ">=", value: 10 },
  { label: "≥ 50", op: ">=", value: 50 },
  { label: "≥ 100", op: ">=", value: 100 },
  { label: "≥ 500", op: ">=", value: 500 },
];

function OccurrencePicker({ facets, onChange }: { facets: FacetState; onChange: (next: FacetState) => void }) {
  const cur = facets.occurrences;
  const [op, setOp] = useState<OccurrenceOp>(cur?.op ?? ">=");
  const [value, setValue] = useState<string>(cur ? String(cur.value) : "");

  function apply(nextOp: OccurrenceOp, nextValue: string) {
    const n = Number(nextValue);
    if (nextValue.trim() === "" || Number.isNaN(n)) onChange({ ...facets, occurrences: null });
    else onChange({ ...facets, occurrences: { op: nextOp, value: n } });
  }

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <div className="flex flex-wrap gap-1">
        {OCCURRENCE_PRESETS.map((p) => {
          const active = cur?.op === p.op && cur?.value === p.value;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setOp(p.op);
                setValue(String(p.value));
                onChange({ ...facets, occurrences: active ? null : { op: p.op, value: p.value } });
              }}
              className={cn(
                "inline-flex h-6 items-center rounded-md border px-2 text-xs tabular-nums transition-colors",
                active ? "selected font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(["≥", "≤"] as const).map((sym) => {
            const symOp: OccurrenceOp = sym === "≥" ? ">=" : "<=";
            const active = op === symOp;
            return (
              <button
                key={sym}
                type="button"
                onClick={() => {
                  setOp(symOp);
                  apply(symOp, value);
                }}
                className={cn("inline-flex size-5 items-center justify-center rounded text-xs transition-colors", active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {sym}
              </button>
            );
          })}
        </div>
        <Input
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d]/g, "");
            setValue(v);
            apply(op, v);
          }}
          placeholder="count"
          className="h-7 flex-1 text-xs tabular-nums"
        />
      </div>
    </div>
  );
}
