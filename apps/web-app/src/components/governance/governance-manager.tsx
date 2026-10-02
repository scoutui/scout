"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Edit2, Plus, Trash2 } from "lucide-react";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import type {
  Disposition,
  GovernanceInput,
  GovernanceRecord,
  RecordStat,
} from "@scoutui/web-shared";
import { type GovernanceField, invalidGovernanceFields } from "@scoutui/web-shared/client";
import { saveGovernance, deleteGovernance } from "@/app/governance/governance-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toggleVariants } from "@/components/ui/toggle";
import { GroupedIdentityPicker, type IdentityPick } from "@/components/governance/grouped-identity-picker";
import { RecordSearch } from "@/components/governance/record-search";
import { actionErrorMessage } from "@/lib/action-error";
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

function sourceLabel(r: GovernanceRecord): string {
  return r.targetExport ? `${r.targetPackage} / ${r.targetExport}` : r.targetPackage;
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

// Both dispositions are deprecation, so both dots are warn; the kind is named beside it.
const KIND_DOT: Record<DispositionKind, string> = {
  superseded: "bg-status-warn",
  retired: "bg-status-warn",
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
}

export function GovernanceManager({ records, sources, stats, repoCount }: GovernanceManagerProps) {
  // With no records, the form opens straight away.
  const [formOpen, setFormOpen] = useState(records.length === 0);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [query, setQuery] = useState("");

  // The search filters every section below, not just the flat list.
  const visible = records.filter((r) => matchesRecordQuery(r, query));

  // Records that never matched a scan go first: they are likely config mistakes.
  const exceptions = visible.filter((r) => stats[r.id]?.status === "unseen");
  const unseenIds = new Set(exceptions.map((r) => r.id));

  // A package gets a group heading from two records up. Single-record packages
  // render as flat rows, with their full identity, in one shared panel.
  const byPackage = new Map<string, GovernanceRecord[]>();
  for (const r of visible) {
    if (unseenIds.has(r.id)) continue;
    const rows = byPackage.get(r.targetPackage) ?? [];
    rows.push(r);
    byPackage.set(r.targetPackage, rows);
  }
  // Still-working records first, settled ones last, alpha within.
  const rank = (r: GovernanceRecord) => (stats[r.id]?.status === "complete" ? 1 : 0);
  for (const rows of byPackage.values()) {
    rows.sort((a, b) => rank(a) - rank(b) || (a.targetExport ?? "").localeCompare(b.targetExport ?? ""));
  }
  const groups = [...byPackage.entries()]
    .filter(([, rows]) => rows.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));
  const singles = [...byPackage.values()]
    .filter((rows) => rows.length === 1)
    .flat()
    .sort((a, b) => rank(a) - rank(b) || a.targetPackage.localeCompare(b.targetPackage));

  function openNew() {
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(r: GovernanceRecord) {
    setForm(recordToForm(r));
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
  }

  return (
    <div className="space-y-6">
      {/* Section header row */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="max-w-prose text-sm text-muted-foreground">
            Mark packages and components as superseded or retired. Each record marks the package or component as deprecated everywhere it appears.
          </p>
        </div>
        <Button size="sm" onClick={openNew} disabled={formOpen}>
          <Plus />
          Add record
        </Button>
      </div>

      {formOpen && (
        <RecordForm
          form={form}
          setForm={setForm}
          sources={sources}
          onDone={closeForm}
          onJumpToRecord={() => {
            setQuery("");
            closeForm();
          }}
        />
      )}

      {records.length > 1 ? (
        <RecordSearch value={query} onChange={setQuery} count={visible.length} />
      ) : null}

      {/* Records */}
      {records.length === 0 && !formOpen ? (
        <div className="space-y-1 py-4">
          <p className="text-sm text-muted-foreground">
            No lifecycle records yet.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {query.trim() && visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No records match “{query.trim()}”.
            </p>
          ) : null}

          {exceptions.length > 0 ? (
            <section aria-label="Records that never matched a scan" className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs text-status-warn-text">
                <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                {exceptions.length === 1
                  ? "1 record never matched a scan"
                  : `${exceptions.length.toLocaleString()} records never matched a scan`}
                {". Check the package and component names."}
              </p>
              <ul className="panel divide-y divide-border overflow-hidden">
                {exceptions.map((r) => (
                  <RecordRow
                    key={r.id}
                    record={r}
                    standalone
                    repoCount={repoCount}
                    onEdit={() => openEdit(r)}
                    {...(stats[r.id] ? { stat: stats[r.id] as RecordStat } : {})}
                    {...(form.id !== undefined ? { editingId: form.id } : {})}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {groups.map(([pkg, rows]) => (
            <section key={pkg}>
              {/* A real heading, so screen-reader heading navigation can jump
                  between package groups. */}
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="min-w-0 truncate font-mono text-xs text-foreground">{pkg}</h2>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {rows.length.toLocaleString()} records
                </span>
              </div>
              <ul className="panel divide-y divide-border overflow-hidden">
                {rows.map((r) => (
                  <RecordRow
                    key={r.id}
                    record={r}
                    repoCount={repoCount}
                    onEdit={() => openEdit(r)}
                    {...(stats[r.id] ? { stat: stats[r.id] as RecordStat } : {})}
                    {...(form.id !== undefined ? { editingId: form.id } : {})}
                  />
                ))}
              </ul>
            </section>
          ))}

          {/* Single-record packages: rows carry their full identity, so the
              panel has no heading. */}
          {singles.length > 0 ? (
            <ul className="panel divide-y divide-border overflow-hidden">
              {singles.map((r) => (
                <RecordRow
                  key={r.id}
                  record={r}
                  standalone
                  repoCount={repoCount}
                  onEdit={() => openEdit(r)}
                  {...(stats[r.id] ? { stat: stats[r.id] as RecordStat } : {})}
                  {...(form.id !== undefined ? { editingId: form.id } : {})}
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record row
// ---------------------------------------------------------------------------

function RecordRow({
  record,
  stat,
  repoCount,
  standalone = false,
  onEdit,
  editingId,
}: {
  record: GovernanceRecord;
  stat?: RecordStat | undefined;
  repoCount: number;
  /** Row outside a package group: identity carries the full package (and export). */
  standalone?: boolean;
  onEdit: () => void;
  editingId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const isEditing = editingId === record.id;
  const superseded = record.disposition.kind === "superseded";
  const retired = record.disposition.kind === "retired";

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteGovernance(record.id);
      if (res.ok) setConfirming(false);
      else setError(actionErrorMessage(res.error, "delete this record", "Couldn't delete the record. Try again."));
    });
  }

  return (
    <li
      id={`record-${record.id}`}
      tabIndex={-1}
      className={cn(
        "flex flex-col gap-1 px-3 py-2.5 text-sm scroll-mt-24",
        isEditing && "bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Identity: inside a package group the heading names the package, so the
            row shows only the export; a standalone row shows the full identity. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          {standalone ? (
            <span className="min-w-0 truncate font-mono text-xs text-foreground">
              {sourceLabel(record)}
            </span>
          ) : record.targetExport ? (
            <span className="shrink-0 font-mono text-xs text-foreground">{record.targetExport}</span>
          ) : (
            <span className="shrink-0 text-xs text-foreground italic">entire package</span>
          )}
          <span className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", KIND_DOT[record.disposition.kind])}
            />
            {superseded && (
              <>
                <span>superseded</span>
                <span aria-hidden>→</span>
                <span className="truncate font-mono text-foreground/90">
                  {dispositionLabel(record.disposition)}
                </span>
              </>
            )}
            {retired && <span className="truncate">retired · {dispositionLabel(record.disposition)}</span>}
          </span>
          {stat?.successorDeprecated ? (
            <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-status-warn-text">
              <AlertTriangle aria-hidden className="size-3 shrink-0" />
              successor deprecated
            </span>
          ) : null}
        </div>

        {/* Status: active and complete rows link to their chart; a record that
            never matched a scan shows a warning instead. */}
        {stat ? (
          stat.status === "unseen" ? (
            <span className="shrink-0 text-xs font-medium text-status-warn-text">never matched a scan</span>
          ) : stat.trackingId ? (
            <Link
              href={`/charts/${encodeURIComponent(stat.trackingId)}`}
              className="shrink-0 rounded-sm text-xs tabular-nums text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
            >
              {stat.status === "complete"
                ? "complete"
                : repoCount > 1
                  ? `active in ${stat.repos.toLocaleString()} ${stat.repos === 1 ? "repo" : "repos"}`
                  : "active"}
            </Link>
          ) : null
        ) : null}

        {/* Actions: delete asks for an inline confirm. */}
        <div className="flex shrink-0 items-center gap-1">
          {confirming ? (
            <>
              <Button variant="destructive" size="xs" onClick={remove} disabled={pending}>
                {pending ? "Deleting…" : "Confirm"}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit record">
                <Edit2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setConfirming(true)}
                aria-label="Delete record"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Disposition radio group (arrow keys select)
// ---------------------------------------------------------------------------

function DispositionRadioGroup({
  value,
  onChange,
  labelledBy,
}: {
  value: DispositionKind;
  onChange: (kind: DispositionKind) => void;
  labelledBy: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as DispositionKind)}
      aria-labelledby={labelledBy}
      className="flex w-fit flex-row items-center"
    >
      {DISPOSITION_KINDS.map((k) => (
        <Radio.Root
          key={k}
          value={k}
          className={cn(
            toggleVariants({ variant: "outline", size: "sm" }),
            "rounded-none px-2 first:rounded-l-lg last:rounded-r-lg [&:not(:first-child)]:border-l-0",
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
  onDone,
  onJumpToRecord,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  sources: AutocompleteSource[];
  onDone: () => void;
  onJumpToRecord: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(form.id);

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
        onDone();
        return;
      }
      setError(actionErrorMessage(res.error, "save this record", "Couldn't save the record. Try again."));
      const c = res.conflict;
      setConflictId(
        c?.kind === "target_governed" || c?.kind === "package_grain_overlap" ? c.existingId : null,
      );
    });
  }

  const sourceComponentValue =
    form.grain === "component" && form.targetExport
      ? `${form.targetPackage}/${form.targetExport}`
      : form.targetPackage;

  const supersededByValue = form.supersededByPackage
    ? form.supersededByExport
      ? `${form.supersededByPackage}/${form.supersededByExport}`
      : form.supersededByPackage
    : "";

  return (
    <div className="panel space-y-4 p-4">
      <h2 className="text-sm font-medium">
        {isEdit ? "Edit record" : "New lifecycle record"}
      </h2>

      {/* Source picker: the pick decides the grain */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="gov-source" className="text-label text-muted-foreground">
          Source
        </label>
        <GroupedIdentityPicker
          id="gov-source"
          sources={sources}
          value={sourceComponentValue}
          onSelect={handleSourcePick}
          placeholder="Select a scanned package or component…"
          ariaLabel={sourceComponentValue ? `Source: ${sourceComponentValue}` : "Source: none selected"}
          ariaDescribedBy={fieldErrors.source ? "gov-source-error" : undefined}
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

      {/* Disposition selector */}
      <div className="space-y-1.5">
        <span id="gov-disposition-label" className="block text-label text-muted-foreground">
          Disposition
        </span>
        <DispositionRadioGroup
          value={form.dispositionKind}
          onChange={(k) => patch({ dispositionKind: k })}
          labelledBy="gov-disposition-label"
        />
      </div>

      {/* Disposition-specific fields */}
      {form.dispositionKind === "superseded" && (
        <div className="flex flex-col gap-1.5">
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
            ariaLabel={supersededByValue ? `Superseded by: ${supersededByValue}` : "Superseded by: none selected"}
            ariaDescribedBy={fieldErrors.supersededBy ? "gov-by-error" : undefined}
          />
          <FieldError id="gov-by-error" message={fieldErrors.supersededBy} />
          {form.supersededByPackage && !form.supersededByExport ? (
            <p className="text-[0.6875rem] text-muted-foreground">
              The whole package is the replacement.
            </p>
          ) : null}
        </div>
      )}

      {form.dispositionKind === "retired" && (
        <div className="flex flex-col gap-1.5">
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
            placeholder="Removed in v3; no replacement."
            aria-describedby={fieldErrors.reason ? "gov-reason-error" : undefined}
            aria-invalid={fieldErrors.reason ? true : undefined}
          />
          <FieldError id="gov-reason-error" message={fieldErrors.reason} />
        </div>
      )}

      {/* Server errors only; field errors render next to their fields. */}
      {error && (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          <p>{error}</p>
          {conflictId ? (
            <a
              href={`#record-${conflictId}`}
              onClick={onJumpToRecord}
              className="inline-block rounded-sm underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
            >
              Go to the existing record
            </a>
          ) : null}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="xs" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button size="xs" onClick={submit} disabled={pending}>
          {isEdit ? "Save changes" : "Create"}
        </Button>
      </div>
    </div>
  );
}
