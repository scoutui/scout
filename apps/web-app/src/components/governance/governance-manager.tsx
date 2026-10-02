"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, CircleCheck, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
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
  countLabel,
  groupRecords,
  type Left,
  leftOf,
  leftText,
  type MapRow,
  type PackageGroup,
  type RecordMap,
  recordCountLabel,
  recordHref,
  rowName,
  type Successor,
  successorLabel,
  wholePackageLabel,
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

/** Client-side record filter: identity, successor, and reason are the fields a user searches by. */
export function matchesRecordQuery(record: GovernanceRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    pickLabel({ packageName: record.targetPackage, exportName: record.targetExport ?? undefined }),
    record.disposition.kind === "superseded" ? pickLabel(record.disposition.by) : record.disposition.reason,
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
  /** Packages the user folded; a search shows its matches open without changing this. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [completeOpen, setCompleteOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** The record to scroll to and focus once its row is on the page. */
  const revealId = useRef<string | null>(null);
  const recordsRef = useRef(records);
  const addRecordRef = useRef<HTMLButtonElement>(null);
  /** Set when Cancel or Delete closes the form: the record whose row takes focus, or undefined for Add record. */
  const [focusAfterClose, setFocusAfterClose] = useState<{ recordId: string | undefined } | null>(null);

  const editingId = formOpen ? form.id : undefined;
  const searching = query.trim() !== "";
  const matches = records.filter((r) => matchesRecordQuery(r, query));
  const visible = records.filter((r) => r.id === editingId || matchesRecordQuery(r, query));
  const map = groupRecords({ visible, all: records, stats, sources });

  // Scrolls to the record and focuses its name once its row is on the page, opening what hides it first.
  useEffect(() => {
    const id = revealId.current;
    if (!id) return;
    const row = document.getElementById(`record-${id}`);
    if (row) {
      revealId.current = null;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: reduceMotion ? "instant" : "smooth" });
      (row.querySelector<HTMLElement>("th a") ?? row).focus({ preventScroll: true });
      return;
    }
    const complete = map.complete.find((g) => rowsOf(g).some((r) => r.record.id === id));
    const group = complete ?? map.groups.find((g) => rowsOf(g).some((r) => r.record.id === id));
    if (!group) return;
    if (complete) setCompleteOpen(true);
    setFolded((prev) => {
      if (!prev.has(group.packageName)) return prev;
      const next = new Set(prev);
      next.delete(group.packageName);
      return next;
    });
  });

  useEffect(() => {
    recordsRef.current = records;
  });

  useEffect(() => {
    function arrive() {
      const id = /^#record-(.+)$/.exec(window.location.hash)?.[1];
      if (!id || !recordsRef.current.some((r) => r.id === id)) return;
      setQuery("");
      revealId.current = id;
      setHighlightId(id);
    }
    arrive();
    window.addEventListener("hashchange", arrive);
    return () => window.removeEventListener("hashchange", arrive);
  }, []);

  useEffect(() => {
    if (!focusAfterClose) return;
    setFocusAfterClose(null);
    const row = focusAfterClose.recordId ? document.getElementById(`record-${focusAfterClose.recordId}`) : null;
    (row ?? addRecordRef.current)?.focus();
  }, [focusAfterClose]);

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

  function cancelForm() {
    setFocusAfterClose({ recordId: form.id });
    closeForm();
  }

  function onDeleted() {
    setFocusAfterClose({ recordId: undefined });
    closeForm();
  }

  function showRecord(id: string) {
    setQuery("");
    closeForm();
    revealId.current = id;
    setHighlightId(id);
  }

  function search(value: string) {
    setQuery(value);
    setHighlightId(null);
  }

  function toggleFold(packageName: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(packageName)) next.add(packageName);
      return next;
    });
  }

  const recordForm = formOpen ? (
    <RecordForm
      form={form}
      setForm={setForm}
      sources={sources}
      takeFocus={focusForm}
      onCancel={cancelForm}
      onDeleted={onDeleted}
      onSaved={showRecord}
      onJumpToRecord={showRecord}
    />
  ) : null;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight">Governance</h1>
            <Button ref={addRecordRef} size="sm" onClick={openNew} disabled={formOpen && !form.id}>
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

      {records.length > 1 || query !== "" ? (
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

          {map.groups.length > 0 || map.complete.length > 0 ? (
            <RecordTable
              map={map}
              recordCount={records.length}
              repoCount={repoCount}
              editingId={editingId}
              editForm={recordForm}
              highlightId={highlightId}
              isOpen={(packageName) => searching || !folded.has(packageName)}
              completeShown={searching || completeOpen}
              onFold={toggleFold}
              onToggleComplete={() => setCompleteOpen((open) => !open)}
              onEdit={openEdit}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records table
// ---------------------------------------------------------------------------

// Below sm the header hides and each row stacks: name and edit, then the decision, then the count.
const ROW = "grid grid-cols-[minmax(0,1fr)_3rem] items-center sm:grid-cols-[16rem_6.5rem_minmax(0,1fr)_11rem_3rem]";
const OCC_CELL = "flex min-w-0 items-center pl-3";
const EDIT_CELL = "flex min-w-0 justify-end pr-3";
const LINK =
  "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring";
const CHEVRON = "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none";

const rowsOf = (group: PackageGroup) => (group.kind === "whole" ? [group.row] : group.rows);

function RecordTable({
  map,
  recordCount,
  repoCount,
  editingId,
  editForm,
  highlightId,
  isOpen,
  completeShown,
  onFold,
  onToggleComplete,
  onEdit,
}: {
  map: RecordMap;
  recordCount: number;
  repoCount: number;
  editingId: string | undefined;
  /** Shown in place of the row being edited. */
  editForm: React.ReactNode;
  highlightId: string | null;
  isOpen: (packageName: string) => boolean;
  completeShown: boolean;
  onFold: (packageName: string) => void;
  onToggleComplete: () => void;
  onEdit: (record: GovernanceRecord) => void;
}) {
  const titleId = useId();

  const recordRow = (row: MapRow, standalone: boolean) =>
    row.record.id === editingId ? (
      <tr key={row.record.id} id={`record-${row.record.id}`} className={ROW}>
        <td className="col-span-full bg-muted/40 p-4">{editForm}</td>
      </tr>
    ) : (
      <RecordRow
        key={row.record.id}
        row={row}
        standalone={standalone}
        repoCount={repoCount}
        highlighted={row.record.id === highlightId}
        onEdit={() => onEdit(row.record)}
      />
    );

  const groupBody = (group: PackageGroup) => {
    if (group.kind === "whole") {
      return (
        <tbody key={group.packageName} className="block">
          {recordRow(group.row, true)}
        </tbody>
      );
    }
    const open = isOpen(group.packageName);
    return (
      <tbody key={group.packageName} className="block pt-1 pb-1.5">
        <GroupHeader group={group} open={open} repoCount={repoCount} onFold={() => onFold(group.packageName)} />
        {group.rows.filter((row) => open || row.record.id === editingId).map((row) => recordRow(row, false))}
      </tbody>
    );
  };

  const hiddenEdit = completeShown ? undefined : map.complete.flatMap(rowsOf).find((row) => row.record.id === editingId);

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id={titleId} className="text-base font-medium">
          Records
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {recordCountLabel(recordCount)} · counts from each repo's latest scan
        </span>
      </div>
      <table aria-labelledby={titleId} className="panel block overflow-hidden [&>tbody+tbody]:border-t">
        <thead className="block max-sm:sr-only">
          <tr className={cn(ROW, "h-9 border-b border-border bg-muted")}>
            <th scope="col" className="min-w-0 pr-3 pl-8 text-left text-label text-muted-foreground">
              Name
            </th>
            <td />
            <th scope="col" className="min-w-0 px-3 text-left text-label text-muted-foreground">
              Replacement or reason
            </th>
            <th scope="col" className={cn(OCC_CELL, "text-left text-label text-muted-foreground")}>
              Occurrences left
            </th>
            <th scope="col" className={EDIT_CELL}>
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        {map.groups.map(groupBody)}
        {map.complete.length > 0 ? (
          <tbody className="block pt-1 pb-1.5">
            <tr className={cn(ROW, "min-h-10")}>
              <th scope="row" className="col-span-full self-stretch text-left font-normal">
                <button
                  type="button"
                  aria-expanded={completeShown}
                  onClick={onToggleComplete}
                  className="group/toggle flex size-full min-h-10 cursor-pointer items-center gap-1.5 px-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
                >
                  <ChevronRight
                    aria-hidden
                    strokeWidth={1.5}
                    className={cn(CHEVRON, "group-hover/toggle:text-foreground", completeShown && "rotate-90")}
                  />
                  <span className="text-xs font-medium text-muted-foreground group-hover/toggle:text-foreground">
                    {completeShown
                      ? `${map.completeRecords.toLocaleString()} complete`
                      : `Show ${map.completeRecords.toLocaleString()} complete`}
                  </span>
                </button>
              </th>
            </tr>
          </tbody>
        ) : null}
        {completeShown ? map.complete.map(groupBody) : null}
        {hiddenEdit ? <tbody className="block">{recordRow(hiddenEdit, true)}</tbody> : null}
      </table>
    </section>
  );
}

function GroupHeader({
  group,
  open,
  repoCount,
  onFold,
}: {
  group: Extract<PackageGroup, { kind: "components" }>;
  open: boolean;
  repoCount: number;
  onFold: () => void;
}) {
  const name = "min-w-0 font-mono text-xs font-medium wrap-anywhere sm:truncate";
  return (
    <tr className={cn(ROW, "min-h-10 max-sm:py-1")}>
      <th scope="row" className="min-w-0 self-stretch text-left font-normal max-sm:col-span-full max-sm:h-8">
        <div className="flex h-full min-w-0 items-center pl-[0.4375rem]">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`Records in ${group.packageName}`}
            onClick={onFold}
            className="group/fold mr-px inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
          >
            <ChevronRight
              aria-hidden
              strokeWidth={1.5}
              className={cn(CHEVRON, "group-hover/fold:text-foreground", open && "rotate-90")}
            />
          </button>
          <span className="flex min-w-0 items-baseline">
            {group.href ? (
              <Link href={group.href} title={group.packageName} className={cn(name, LINK)}>
                {group.packageName}
              </Link>
            ) : (
              <span title={group.packageName} className={name}>
                {group.packageName}
              </span>
            )}
            <span className="shrink-0 text-xs whitespace-pre text-muted-foreground"> · {countLabel(group.recordCount)}</span>
          </span>
        </div>
      </th>
      <td className="max-sm:hidden" />
      <td className="max-sm:hidden" />
      <td className={cn(OCC_CELL, "max-sm:col-span-full max-sm:pr-3 max-sm:pl-8")}>
        <Occurrences left={group.left} repoCount={repoCount} trend={null} selected={false} />
      </td>
      <td className="max-sm:hidden" />
    </tr>
  );
}

function RecordRow({
  row,
  standalone,
  repoCount,
  highlighted,
  onEdit,
}: {
  row: MapRow;
  /** A whole-package record, alone in its group. */
  standalone: boolean;
  repoCount: number;
  highlighted: boolean;
  onEdit: () => void;
}) {
  const { record, stat, componentCount, nextHop } = row;
  const name = rowName(record);
  const href = recordHref(record, stat);
  const nameClass = "inline-block max-w-full align-top font-mono text-xs wrap-anywhere sm:truncate";
  const nameEl = href ? (
    <Link href={href} title={name} className={cn(nameClass, LINK)}>
      {name}
    </Link>
  ) : (
    <span title={name} className={nameClass}>
      {name}
    </span>
  );
  return (
    <tr
      id={`record-${record.id}`}
      tabIndex={-1}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        ROW,
        "group/row min-h-9 scroll-mt-24 py-1.5 outline-none transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring motion-reduce:transition-none max-sm:gap-y-1 max-sm:py-2",
        standalone && "py-[0.6875rem] max-sm:py-3",
        highlighted
          ? "selected shadow-[inset_0_1px_0_var(--selected-edge),inset_0_-1px_0_var(--selected-edge)]"
          : "hover:bg-secondary dark:hover:bg-accent",
      )}
    >
      <th scope="row" className="min-w-0 pr-3 pl-8 text-left font-normal max-sm:col-start-1 max-sm:row-start-1">
        {record.grain === "package" ? (
          <span className="flex min-w-0 flex-col items-start max-sm:gap-y-1">
            {nameEl}
            <span className="text-xs whitespace-nowrap text-muted-foreground">{wholePackageLabel(componentCount)}</span>
          </span>
        ) : (
          nameEl
        )}
      </th>
      <td className="min-w-0 pl-3 text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">
        {record.disposition.kind === "superseded" ? "Superseded by" : "Retired"}
      </td>
      <td className="min-w-0 px-3 max-sm:col-span-full max-sm:row-start-2 max-sm:pl-8">
        {record.disposition.kind === "superseded" ? (
          <SuccessorCell by={record.disposition.by} deprecated={stat?.successorDeprecated === true} nextHop={nextHop} />
        ) : (
          <span
            title={record.disposition.reason}
            className="block text-sm/normal wrap-anywhere sm:line-clamp-2 sm:group-focus-within/row:line-clamp-none sm:group-hover/row:line-clamp-none"
          >
            <span className="text-xs text-muted-foreground sm:hidden">Retired · </span>
            {record.disposition.reason}
          </span>
        )}
      </td>
      <td className={cn(OCC_CELL, "max-sm:col-span-full max-sm:row-start-3 max-sm:pr-3 max-sm:pl-8")}>
        <Occurrences
          left={leftOf(stat)}
          repoCount={repoCount}
          trend={stat?.trackingId ? { href: `/charts/${encodeURIComponent(stat.trackingId)}`, name } : null}
          selected={highlighted}
        />
      </td>
      <td className={cn(EDIT_CELL, "max-sm:col-start-2 max-sm:row-start-1 max-sm:self-start")}>
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
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 sm:flex-nowrap">
      <span
        className="min-w-0 font-mono text-xs wrap-anywhere sm:truncate"
        title={pickLabel(by)}
      >
        <span className="font-sans text-muted-foreground sm:hidden">Superseded by </span>
        <span className="text-foreground">{successor.name}</span>
        {successor.packageName ? <span className="text-muted-foreground"> · {successor.packageName}</span> : null}
      </span>
      {deprecated ? (
        <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-status-warn-text">
          <TriangleAlert aria-hidden strokeWidth={1.5} className="size-3 shrink-0" />
          Successor deprecated
        </span>
      ) : null}
      {nextHop ? (
        <span className="min-w-0 font-mono text-[0.6875rem] text-muted-foreground wrap-anywhere sm:flex-1 sm:truncate">
          {`→ ${pickLabel(nextHop)}`}
        </span>
      ) : null}
    </div>
  );
}

/** The number right-aligned in its slot, then the words; a record's count links to its trend. */
function Occurrences({
  left,
  repoCount,
  trend,
  selected,
}: {
  left: Left;
  repoCount: number;
  trend: { href: string; name: string } | null;
  /** On the selected fill, None left mixes in some ink. */
  selected: boolean;
}) {
  const t = leftText(left, repoCount);
  const ok = selected ? "text-[color-mix(in_oklab,var(--status-ok)_85%,var(--foreground))]" : "text-status-ok";
  const slot = "flex justify-end max-sm:justify-start max-sm:empty:hidden";
  const look =
    "inline-grid grid-cols-[2.25rem_auto] items-center gap-x-1.5 text-sm whitespace-nowrap tabular-nums max-sm:grid-cols-[auto_auto] max-sm:gap-x-1";
  let content: React.ReactNode;
  if (t.kind === "count") {
    content = (
      <>
        <span className={slot}>{t.n}</span>
        {t.where === null ? (
          <span className="sm:hidden">left</span>
        ) : (
          <span>
            <span className="sm:hidden">left </span>
            in{" "}
            {left.kind === "count" && left.repos.length === 1 ? (
              <span className="font-mono text-xs">{t.where}</span>
            ) : (
              t.where
            )}
          </span>
        )}
      </>
    );
  } else if (t.kind === "none") {
    content = (
      <>
        <span className={cn(slot, ok)}>
          <CircleCheck aria-hidden strokeWidth={1.5} className="size-3.5" />
        </span>
        <span className={ok}>{t.text}</span>
      </>
    );
  } else {
    content = (
      <>
        <span className={slot} />
        <span className={t.kind === "unseen" ? "text-status-warn-text" : "text-muted-foreground"}>{t.text}</span>
      </>
    );
  }
  if (!trend || (t.kind !== "count" && t.kind !== "none")) return <span className={look}>{content}</span>;
  return (
    <Link
      href={trend.href}
      aria-label={`${t.text}, trend for ${trend.name}`}
      className={cn(
        look,
        "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring [&:focus-visible>*]:underline [&:hover>*]:underline",
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
  onCancel,
  onDeleted,
  onSaved,
  onJumpToRecord,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  sources: AutocompleteSource[];
  /** Scroll the form into view and focus its first field when it opens. */
  takeFocus: boolean;
  onCancel: () => void;
  onDeleted: () => void;
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
  const Heading = isEdit ? "h3" : "h2";

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
      if (res.ok) onDeleted();
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
      <Heading className="text-sm font-medium">{isEdit ? "Edit record" : "New record"}</Heading>

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
            {confirmingDelete ? (
              <span id="gov-delete-prompt" className="text-[0.8rem]">
                Delete this record?
              </span>
            ) : null}
            <Button
              ref={deleteRef}
              variant={confirmingDelete ? "destructive" : "ghost"}
              size="sm"
              onClick={confirmingDelete ? remove : () => setConfirmingDelete(true)}
              disabled={pending}
              aria-describedby={confirmingDelete ? "gov-delete-prompt" : undefined}
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
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
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
