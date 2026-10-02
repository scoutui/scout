"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, CircleCheck, CircleDashed, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import type {
  Disposition,
  GovernanceInput,
  GovernanceRecord,
  RecordStat,
} from "@scoutui/web-shared";
import { type GovernanceField, invalidGovernanceFields } from "@scoutui/web-shared/client";
import { deleteGovernance, saveGovernance } from "@/app/governance/governance-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toggleVariants } from "@/components/ui/toggle";
import { GroupedIdentityPicker, type IdentityPick, pickLabel } from "@/components/governance/grouped-identity-picker";
import { RecordSearch } from "@/components/governance/record-search";
import { actionErrorMessage } from "@/lib/action-error";
import {
  buildRecordMap,
  countLabel,
  type MapGroup,
  type MapRow,
  type MapSection,
  progressLabel,
  scopeLabel,
  statusLabel,
  type Successor,
  successorLabel,
} from "@/lib/governance-map";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Autocomplete source types
// ---------------------------------------------------------------------------

export interface AutocompleteSource {
  /** packageName for package-grain picks; also the prefix for component picks. */
  packageName: string;
  /** exportName for component-grain picks; absent for package-only entries. */
  exportName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dispositionLabel(d: Disposition): string {
  switch (d.kind) {
    case "superseded":
      return d.by.exportName
        ? `${d.by.packageName}/${d.by.exportName}`
        : d.by.packageName;
    case "retired":
      return d.reason || "(no reason)";
  }
}

/** Client-side record filter: identity, successor, and reason are the fields a user searches by. */
export function matchesRecordQuery(record: GovernanceRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    record.targetPackage,
    record.targetExport ?? "",
    record.disposition.kind === "superseded"
      ? dispositionLabel(record.disposition)
      : record.disposition.reason,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

const DISPOSITION_KINDS = ["superseded", "retired"] as const;
type DispositionKind = (typeof DISPOSITION_KINDS)[number];

const KIND_LABEL: Record<DispositionKind, string> = {
  superseded: "Superseded",
  retired: "Retired",
};

const KIND_HINT: Record<DispositionKind, string> = {
  superseded: "Superseded: something replaces it.",
  retired: "Retired: it goes with no replacement.",
};

// ---------------------------------------------------------------------------
// Empty form state factory
// ---------------------------------------------------------------------------

interface FormState {
  id?: string;
  grain: "package" | "component";
  targetPackage: string;
  targetExport: string;
  dispositionKind: DispositionKind;
  supersededByPackage: string;
  supersededByExport: string;
  retiredReason: string;
}

function emptyForm(): FormState {
  return {
    grain: "component",
    targetPackage: "",
    targetExport: "",
    dispositionKind: "superseded",
    supersededByPackage: "",
    supersededByExport: "",
    retiredReason: "",
  };
}

function recordToForm(r: GovernanceRecord): FormState {
  const base: FormState = {
    id: r.id,
    grain: r.grain,
    targetPackage: r.targetPackage,
    targetExport: r.targetExport ?? "",
    dispositionKind: r.disposition.kind,
    supersededByPackage: "",
    supersededByExport: "",
    retiredReason: "",
  };
  if (r.disposition.kind === "superseded") {
    base.supersededByPackage = r.disposition.by.packageName;
    base.supersededByExport = r.disposition.by.exportName ?? "";
  } else if (r.disposition.kind === "retired") {
    base.retiredReason = r.disposition.reason;
  }
  return base;
}

function formToInput(f: FormState): GovernanceInput {
  const disposition: Disposition =
    f.dispositionKind === "superseded"
      ? {
          kind: "superseded",
          by: {
            packageName: f.supersededByPackage,
            ...(f.supersededByExport ? { exportName: f.supersededByExport } : {}),
          },
        }
      : { kind: "retired", reason: f.retiredReason };
  return {
    ...(f.id ? { id: f.id } : {}),
    grain: f.grain,
    targetPackage: f.targetPackage,
    targetExport: f.grain === "component" && f.targetExport ? f.targetExport : null,
    disposition,
  };
}

// ---------------------------------------------------------------------------
// Validation: per field, so each error is announced next to its field
// ---------------------------------------------------------------------------

type FieldErrors = {
  source?: string | undefined;
  supersededBy?: string | undefined;
  reason?: string | undefined;
};

const FIELD_ERROR: Record<GovernanceField, [keyof FieldErrors, string]> = {
  targetPackage: ["source", "Choose a package or component."],
  targetExport: ["source", "Choose a component."],
  successor: ["supersededBy", "Choose what supersedes it."],
  reason: ["reason", "Enter a reason."],
};

function validateForm(f: FormState): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of invalidGovernanceFields(formToInput(f))) {
    const [slot, message] = FIELD_ERROR[field];
    errors[slot] = message;
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface GovernanceManagerProps {
  records: GovernanceRecord[];
  sources: AutocompleteSource[];
  stats: Record<string, RecordStat>;
  /** Distinct scanned repos. With one repo, rows don't show a repo count. */
  repoCount: number;
  summary: string | null;
  notice: React.ReactNode;
}

export function GovernanceManager({ records, sources, stats, repoCount, summary, notice }: GovernanceManagerProps) {
  // With no records, the form opens straight away.
  const [formOpen, setFormOpen] = useState(records.length === 0);
  const [form, setForm] = useState<FormState>(emptyForm());
  // Only a form the user opens takes focus, not the one that opens on its own.
  const [focusForm, setFocusForm] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrolledTo = useRef<string | null>(null);

  const editingId = formOpen ? form.id : undefined;
  const searching = query.trim() !== "";
  const matches = records.filter((r) => matchesRecordQuery(r, query));
  const visible = records.filter((r) => r.id === editingId || matchesRecordQuery(r, query));
  const sections = buildRecordMap({ visible, all: records, stats, sources });

  // Scrolls to the highlighted record once its row is on the page, opening its group first if it's folded.
  useEffect(() => {
    if (!highlightId || scrolledTo.current === highlightId) return;
    const row = document.getElementById(`record-${highlightId}`);
    if (row) {
      scrolledTo.current = highlightId;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      row.focus({ preventScroll: true });
      return;
    }
    const key = groupKeyOf(sections, highlightId);
    if (key) setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  });

  useEffect(() => {
    if (!highlightId) return;
    const clear = () => setHighlightId(null);
    document.addEventListener("pointerdown", clear);
    document.addEventListener("keydown", clear);
    return () => {
      document.removeEventListener("pointerdown", clear);
      document.removeEventListener("keydown", clear);
    };
  }, [highlightId]);

  function openNew() {
    setForm(emptyForm());
    setFormOpen(true);
    setFocusForm(true);
  }

  function openEdit(r: GovernanceRecord) {
    setForm(recordToForm(r));
    setFormOpen(true);
    setFocusForm(true);
  }

  function closeForm() {
    setFormOpen(false);
  }

  function showRecord(id: string) {
    scrolledTo.current = null;
    setHighlightId(id);
  }

  function search(value: string) {
    setQuery(value);
    setHighlightId(null);
  }

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const recordForm = formOpen ? (
    <RecordForm
      form={form}
      setForm={setForm}
      sources={sources}
      takeFocus={focusForm}
      onDone={closeForm}
      onSaved={(id) => {
        closeForm();
        showRecord(id);
      }}
      onJumpToRecord={(id) => {
        setQuery("");
        closeForm();
        showRecord(id);
      }}
    />
  ) : null;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight">Governance</h1>
            <Button size="sm" onClick={openNew} disabled={formOpen && !form.id}>
              <Plus />
              Add record
            </Button>
          </div>
          {summary ? <p className="text-xs tabular-nums text-muted-foreground">{summary}</p> : null}
        </div>
        {notice}
        <p className="max-w-prose text-sm text-muted-foreground">
          Mark packages and components as superseded or retired. Each record marks the package or component as deprecated everywhere it appears.
        </p>
      </header>

      {form.id ? null : recordForm}

      {records.length > 1 ? (
        <RecordSearch value={query} onChange={search} count={matches.length} />
      ) : null}

      {records.length === 0 && !formOpen ? (
        <div className="space-y-1 py-4">
          <p className="text-sm text-muted-foreground">
            No lifecycle records yet.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {searching && matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No records match “{query.trim()}”.
            </p>
          ) : null}

          {sections.map((section) => (
            <RecordTable
              key={section.kind}
              section={section}
              repoCount={repoCount}
              editingId={editingId}
              editForm={recordForm}
              highlightId={highlightId}
              searching={searching}
              expanded={expanded}
              onToggle={toggleGroup}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records map
// ---------------------------------------------------------------------------

const MAP_ROW =
  "grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_2.5rem] items-center gap-y-0.5 md:grid-cols-[15rem_1.25rem_minmax(0,1fr)_11rem_2.5rem]";
const CELL = "min-w-0 px-3";
const ARROW_CELL = "flex justify-center px-0";
const STATUS_CELL = "col-span-3 min-w-0 px-3 md:col-span-1";
// Below md the edit button stays on the first line and the status wraps to a second.
const EDIT_CELL = "col-start-4 row-start-1 flex justify-end pr-3 md:col-start-auto md:row-start-auto";

const SECTION_TITLE: Record<MapSection["kind"], string> = { superseded: "Superseded", retired: "Retired" };
const SECTION_COLUMN: Record<MapSection["kind"], string> = { superseded: "Superseded by", retired: "Reason" };

const groupKey = (section: MapSection, group: MapGroup) =>
  `${section.kind}:${group.kind === "package" ? `package:${group.packageName}` : "whole-packages"}`;

function groupKeyOf(sections: MapSection[], id: string): string | null {
  for (const section of sections) {
    for (const group of section.groups) {
      if (group.rows.some((row) => row.record.id === id)) return groupKey(section, group);
    }
  }
  return null;
}

const rowName = (r: GovernanceRecord) => r.targetExport ?? r.targetPackage;

function RecordTable({
  section,
  repoCount,
  editingId,
  editForm,
  highlightId,
  searching,
  expanded,
  onToggle,
  onEdit,
}: {
  section: MapSection;
  repoCount: number;
  editingId: string | undefined;
  /** Shown in place of the row being edited. */
  editForm: React.ReactNode;
  highlightId: string | null;
  searching: boolean;
  /** Keys of the all-complete groups the user has opened. */
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onEdit: (record: GovernanceRecord) => void;
}) {
  const titleId = useId();
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id={titleId} className="text-base font-medium">
          {SECTION_TITLE[section.kind]}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {section.recordCount.toLocaleString()} {section.recordCount === 1 ? "record" : "records"}
        </span>
      </div>
      <table aria-labelledby={titleId} className="panel block overflow-hidden">
        <thead className="block">
          <tr className={cn(MAP_ROW, "h-9 border-b border-border bg-muted")}>
            <th scope="col" className={cn(CELL, "text-left text-label text-muted-foreground")}>
              Package or component
            </th>
            <th scope="col" className={ARROW_CELL} />
            <th scope="col" className={cn(CELL, "text-left text-label text-muted-foreground")}>
              {SECTION_COLUMN[section.kind]}
            </th>
            <th scope="col" className={cn(CELL, "hidden text-left text-label text-muted-foreground md:block")}>
              Status
            </th>
            <th scope="col" className={EDIT_CELL}>
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        {section.groups.map((group, i) => {
          const key = groupKey(section, group);
          const collapsible = !searching && group.rows.every((r) => r.stat?.status === "complete");
          const open = !collapsible || expanded.has(key);
          return (
            <tbody key={key} className={cn("block pt-1 pb-1.5", i > 0 && "border-t border-border")}>
              <GroupHeader
                group={group}
                toggle={collapsible ? { open, onToggle: () => onToggle(key) } : null}
              />
              {group.rows
                .filter((row) => open || row.record.id === editingId)
                .map((row) =>
                  row.record.id === editingId ? (
                    <tr key={row.record.id} id={`record-${row.record.id}`} className={MAP_ROW}>
                      <td className="col-span-full bg-muted/40 p-4">{editForm}</td>
                    </tr>
                  ) : (
                    <RecordRow
                      key={row.record.id}
                      row={row}
                      nested={group.kind === "package"}
                      repoCount={repoCount}
                      highlighted={row.record.id === highlightId}
                      onEdit={() => onEdit(row.record)}
                    />
                  ),
                )}
            </tbody>
          );
        })}
      </table>
    </section>
  );
}

function GroupHeader({
  group,
  toggle,
}: {
  group: MapGroup;
  toggle: { open: boolean; onToggle: () => void } | null;
}) {
  const label =
    group.kind === "package" ? (
      <span className="min-w-0 md:flex md:items-baseline">
        <span className="font-mono text-xs font-medium wrap-anywhere md:truncate" title={group.packageName}>
          {group.packageName}
        </span>
        <span className="text-xs text-muted-foreground md:shrink-0 md:whitespace-pre"> · {countLabel(group.rows.length)}</span>
      </span>
    ) : (
      <span className="text-xs font-medium text-muted-foreground">Whole packages</span>
    );
  return (
    <tr className={cn(MAP_ROW, "min-h-10 py-1.5 md:py-0")}>
      {toggle ? (
        <th scope="row" className="min-w-0 self-stretch text-left font-normal">
          <button
            type="button"
            aria-expanded={toggle.open}
            onClick={toggle.onToggle}
            className="group/toggle flex size-full min-w-0 cursor-pointer items-center gap-1.5 px-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
          >
            {label}
            <ChevronRight
              aria-hidden
              strokeWidth={1.5}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover/toggle:text-foreground motion-reduce:transition-none",
                toggle.open && "rotate-90",
              )}
            />
          </button>
        </th>
      ) : (
        <th scope="row" className={cn(CELL, "text-left font-normal")}>
          {label}
        </th>
      )}
      <td className={ARROW_CELL} />
      <td className={CELL} />
      <td className={cn(STATUS_CELL, "text-xs tabular-nums text-muted-foreground")}>
        {progressLabel(group.progress)}
      </td>
      <td className={EDIT_CELL} />
    </tr>
  );
}

function RecordRow({
  row,
  nested,
  repoCount,
  highlighted,
  onEdit,
}: {
  row: MapRow;
  /** A component row under its package's header, indented one step. */
  nested: boolean;
  repoCount: number;
  highlighted: boolean;
  onEdit: () => void;
}) {
  const { record, stat, componentCount, nextHop } = row;
  const name = rowName(record);
  const scope = record.grain === "package" ? scopeLabel(componentCount) : null;
  return (
    <tr
      id={`record-${record.id}`}
      tabIndex={-1}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        MAP_ROW,
        "group/row min-h-9 scroll-mt-24 py-1.5 transition-colors duration-150 ease-out outline-none hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring md:py-0 dark:hover:bg-accent motion-reduce:transition-none",
        highlighted && "selected",
      )}
    >
      <th scope="row" className={cn(CELL, "text-left font-normal", nested && "pl-8")}>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 md:flex-nowrap">
          <span className="min-w-0 font-mono text-xs wrap-anywhere md:truncate" title={name}>
            {name}
          </span>
          {scope ? <span className="shrink-0 text-[0.6875rem] text-faint">{scope}</span> : null}
        </span>
      </th>
      <td className={ARROW_CELL}>
        {record.disposition.kind === "superseded" ? (
          <>
            <span
              aria-hidden
              className="-translate-y-0.5 text-xs text-faint transition-colors duration-150 ease-out group-hover/row:text-muted-foreground motion-reduce:transition-none"
            >
              →
            </span>
            <span className="sr-only">superseded by</span>
          </>
        ) : null}
      </td>
      <td className={cn(CELL, "md:pl-8")}>
        {record.disposition.kind === "superseded" ? (
          <SuccessorCell by={record.disposition.by} deprecated={stat?.successorDeprecated === true} nextHop={nextHop} />
        ) : (
          <span className="block text-[0.8125rem] wrap-anywhere md:truncate" title={record.disposition.reason}>
            {record.disposition.reason}
          </span>
        )}
      </td>
      <td className={cn(STATUS_CELL, nested && "pl-8 md:pl-3")}>
        <RecordStatus name={name} stat={stat} repoCount={repoCount} />
      </td>
      <td className={EDIT_CELL}>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          aria-label={`Edit ${name}`}
          title="Edit"
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil strokeWidth={1.5} className="size-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function SuccessorCell({
  by,
  deprecated,
  nextHop,
}: {
  by: Successor;
  deprecated: boolean;
  nextHop: Successor | null;
}) {
  const successor = successorLabel(by);
  const hop = nextHop ? successorLabel(nextHop) : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 md:flex-nowrap">
      <span
        className="min-w-0 font-mono text-xs wrap-anywhere md:truncate"
        title={successor.packageName ? `${successor.name} · ${successor.packageName}` : successor.name}
      >
        <span className="text-foreground">{successor.name}</span>
        {successor.packageName ? <span className="text-muted-foreground"> · {successor.packageName}</span> : null}
      </span>
      {deprecated ? (
        <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-status-warn-text">
          <TriangleAlert aria-hidden strokeWidth={1.5} className="size-3 shrink-0" />
          Successor deprecated
        </span>
      ) : null}
      {hop ? (
        <span className="min-w-0 font-mono text-[0.6875rem] text-muted-foreground wrap-anywhere md:flex-1 md:truncate">
          {`→ ${hop.name}${hop.packageName ? ` · ${hop.packageName}` : ""}`}
        </span>
      ) : null}
    </div>
  );
}

const STATUS_LOOK: Record<RecordStat["status"], { Icon: typeof CircleDashed; tone: string }> = {
  active: { Icon: CircleDashed, tone: "text-muted-foreground" },
  complete: { Icon: CircleCheck, tone: "text-status-ok" },
  unseen: { Icon: TriangleAlert, tone: "text-status-warn-text" },
};

function RecordStatus({ name, stat, repoCount }: { name: string; stat: RecordStat | undefined; repoCount: number }) {
  const label = statusLabel(stat, repoCount);
  if (!stat || !label) return null;
  const { Icon, tone } = STATUS_LOOK[stat.status];
  const content = (
    <>
      <Icon aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
      {label}
    </>
  );
  const look = cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums", tone);
  if (stat.status === "unseen" || !stat.trackingId) return <span className={look}>{content}</span>;
  return (
    <Link
      href={`/charts/${encodeURIComponent(stat.trackingId)}`}
      aria-label={`${name}: ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      className={cn(
        look,
        "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring",
        stat.status === "active" && "hover:text-foreground",
      )}
    >
      {content}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Disposition radio group (arrow keys select)
// ---------------------------------------------------------------------------

function DispositionRadioGroup({
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: DispositionKind;
  onChange: (kind: DispositionKind) => void;
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as DispositionKind)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex w-fit flex-row items-center"
    >
      {DISPOSITION_KINDS.map((k) => (
        <Radio.Root
          key={k}
          value={k}
          className={cn(
            toggleVariants({ variant: "outline", size: "sm" }),
            "h-8 rounded-none px-3 text-sm first-of-type:rounded-l-lg last-of-type:rounded-r-lg [&:not(:first-child)]:border-l-0",
            "data-[checked]:selected",
          )}
        >
          {KIND_LABEL[k]}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

function RecordForm({
  form,
  setForm,
  sources,
  takeFocus,
  onDone,
  onSaved,
  onJumpToRecord,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  sources: AutocompleteSource[];
  /** Scroll the form into view and focus its first field when it opens. */
  takeFocus: boolean;
  onDone: () => void;
  onSaved: (id: string) => void;
  onJumpToRecord: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const isEdit = Boolean(form.id);

  useEffect(() => {
    if (!takeFocus) return;
    rootRef.current?.scrollIntoView({ block: "nearest" });
    document.getElementById("gov-source")?.focus({ preventScroll: true });
  }, [takeFocus]);

  function patch(update: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...update }));
  }

  // The pick sets the grain: a package pick makes a package-grain record, an
  // export pick a component-grain one.
  function handleSourcePick(pick: IdentityPick) {
    patch({
      grain: pick.exportName ? "component" : "package",
      targetPackage: pick.packageName,
      targetExport: pick.exportName ?? "",
    });
    setFieldErrors((e) => ({ ...e, source: undefined }));
  }

  function submit() {
    const errors = validateForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setError(null);
    setConflictId(null);
    startTransition(async () => {
      const res = await saveGovernance(formToInput(form));
      if (res.ok) {
        onSaved(res.id);
        return;
      }
      setError(actionErrorMessage(res.error, "save this record", "Couldn't save the record. Try again."));
      const c = res.conflict;
      setConflictId(
        c?.kind === "target_governed" || c?.kind === "package_grain_overlap" ? c.existingId : null,
      );
    });
  }

  function remove() {
    const id = form.id;
    if (!id) return;
    setError(null);
    setConflictId(null);
    startTransition(async () => {
      const res = await deleteGovernance(id);
      if (res.ok) onDone();
      else setError(actionErrorMessage(res.error, "delete this record", "Couldn't delete the record. Try again."));
    });
  }

  const sourceComponentValue = pickLabel(
    form.grain === "component" && form.targetExport
      ? { packageName: form.targetPackage, exportName: form.targetExport }
      : { packageName: form.targetPackage },
  );

  const supersededByValue = pickLabel(
    form.supersededByExport
      ? { packageName: form.supersededByPackage, exportName: form.supersededByExport }
      : { packageName: form.supersededByPackage },
  );

  return (
    <div ref={rootRef} className={cn("scroll-mt-24 scroll-mb-4 space-y-4", !isEdit && "panel p-4")}>
      <h2 className="text-sm font-medium">{isEdit ? "Edit record" : "New record"}</h2>

      {/* Source picker: the pick decides the grain */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="gov-source" className="text-label text-muted-foreground">
          Package or component
        </label>
        <GroupedIdentityPicker
          id="gov-source"
          sources={sources}
          value={sourceComponentValue}
          onSelect={handleSourcePick}
          placeholder="Select a scanned package or component…"
          ariaLabel={`Package or component: ${sourceComponentValue || "none selected"}`}
          ariaDescribedBy={fieldErrors.source ? "gov-source-error" : undefined}
          invalid={Boolean(fieldErrors.source)}
        />
        <FieldError id="gov-source-error" message={fieldErrors.source} />
        {form.targetPackage ? (
          <p className="text-[0.6875rem] text-muted-foreground">
            {form.grain === "component"
              ? "Marks this component only."
              : "Marks every component in the package."}
          </p>
        ) : null}
      </div>

      <div className="space-y-4 sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-6 sm:space-y-0">
        <div className="space-y-1.5 sm:w-min">
          <span id="gov-type-label" className="block text-label text-muted-foreground">
            Type
          </span>
          <DispositionRadioGroup
            value={form.dispositionKind}
            onChange={(k) => patch({ dispositionKind: k })}
            labelledBy="gov-type-label"
            describedBy="gov-type-hint"
          />
          <p id="gov-type-hint" className="text-[0.6875rem] text-muted-foreground">
            {KIND_HINT[form.dispositionKind]}
          </p>
        </div>

        {form.dispositionKind === "superseded" ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="gov-by" className="text-label text-muted-foreground">
              Superseded by
            </label>
            <GroupedIdentityPicker
              id="gov-by"
              sources={sources}
              value={supersededByValue}
              onSelect={(pick) => {
                patch({ supersededByPackage: pick.packageName, supersededByExport: pick.exportName ?? "" });
                setFieldErrors((e) => ({ ...e, supersededBy: undefined }));
              }}
              placeholder="Select the replacement package or component…"
              ariaLabel={`Superseded by: ${supersededByValue || "none selected"}`}
              ariaDescribedBy={fieldErrors.supersededBy ? "gov-by-error" : undefined}
              invalid={Boolean(fieldErrors.supersededBy)}
            />
            <FieldError id="gov-by-error" message={fieldErrors.supersededBy} />
            {form.supersededByPackage && !form.supersededByExport ? (
              <p className="text-[0.6875rem] text-muted-foreground">
                The whole package is the replacement.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="gov-reason" className="text-label text-muted-foreground">
              Reason
            </label>
            <Input
              id="gov-reason"
              value={form.retiredReason}
              onChange={(e) => {
                patch({ retiredReason: e.target.value });
                setFieldErrors((err) => ({ ...err, reason: undefined }));
              }}
              aria-describedby={fieldErrors.reason ? "gov-reason-error gov-reason-hint" : "gov-reason-hint"}
              aria-invalid={fieldErrors.reason ? true : undefined}
            />
            <FieldError id="gov-reason-error" message={fieldErrors.reason} />
            <p id="gov-reason-hint" className="text-[0.6875rem] text-muted-foreground">
              Shown on the record, for example why there's no replacement.
            </p>
          </div>
        )}
      </div>

      {/* Server errors only; field errors render next to their fields. */}
      {error && (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          <p>{error}</p>
          {conflictId ? (
            <a
              href={`#record-${conflictId}`}
              onClick={(e) => {
                e.preventDefault();
                onJumpToRecord(conflictId);
              }}
              className="inline-block rounded-sm underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
            >
              Go to the existing record
            </a>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {isEdit ? (
          <div className="flex items-center gap-2">
            {confirmingDelete ? <span className="text-[0.8rem]">Delete this record?</span> : null}
            <Button
              ref={deleteRef}
              variant={confirmingDelete ? "destructive" : "ghost"}
              size="sm"
              onClick={confirmingDelete ? remove : () => setConfirmingDelete(true)}
              disabled={pending}
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
            {isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
