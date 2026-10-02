import { z } from "zod";
import { componentKey } from "./component-key.js";
import { SCHEMA_VERSION } from "./schema-version.js";

/** A non-null, non-array object. */
export function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A nested shape typed here in TypeScript, checked as a plain object only. */
const plainObject = <T>() => z.custom<T>((value) => isPlainObject(value));

const nonEmptyString = z.string().min(1);
const finiteNumber = z.number().finite();
/** A string `Date.parse` accepts. */
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

/** Adds a cross-field issue at `path`, relative to the refined value. */
function fail(ctx: z.RefinementCtx, path: (string | number)[]): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path });
}

/** A value in an open list whose `kind` this version doesn't know. Its other fields are kept, unchecked. */
type OtherKind = { kind: string };

/**
 * An open list keyed by `kind`: a known kind is checked against its variant, and any other non-empty kind passes
 * with its other fields kept, unchecked.
 */
function openKinds<
  Variants extends [z.ZodDiscriminatedUnionOption<"kind">, ...z.ZodDiscriminatedUnionOption<"kind">[]],
>(...variants: Variants): z.ZodType<z.infer<Variants[number]> | OtherKind> {
  const known = z.discriminatedUnion("kind", variants);
  const other = z
    .object({ kind: nonEmptyString })
    .passthrough()
    .superRefine((value, ctx) => {
      // A known kind gets here only when its variant failed: its variant's issues, at their fields, reject it.
      if (!known.optionsMap.has(value.kind)) return;
      for (const issue of known.safeParse(value).error?.issues ?? []) ctx.addIssue(issue);
    });
  return z.union([known, other]);
}

/** An open list of plain values: any non-empty string passes, including one this version doesn't know. */
const openValue = nonEmptyString;

/**
 * The variants of an open `kind` list that this scanner writes: `T` without the fallback for a kind it doesn't know.
 * The scanner builds these values as `Known<T>`, so the compiler checks each one against its variant.
 */
export type Known<T extends { kind: string }> = T extends unknown ? (string extends T["kind"] ? never : T) : never;

/**
 * Whether an open-list value has the known `kind`, narrowing it to that variant. The narrowing holds for a value
 * `validateArtifact` accepted, which checks a known kind's fields, and for one the scanner built as `Known<T>`.
 */
export function isKind<T extends { kind: string }, const K extends Known<T>["kind"]>(
  value: T,
  kind: K,
): value is Extract<T, { kind: K }> {
  return value.kind === kind;
}

/** The fields naming a repository declaration, in both an identity and an attribution target. */
const repositoryDeclarationFields = { repoId: nonEmptyString, filePath: nonEmptyString, exportName: nonEmptyString };

const identitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("package-export"), packageName: nonEmptyString, publicEntry: z.string(), exportName: nonEmptyString }),
  z.object({ kind: z.literal("repository-declaration"), ...repositoryDeclarationFields }),
  z.object({ kind: z.literal("tag"), tagName: nonEmptyString }),
]);
export type Identity = z.infer<typeof identitySchema>;

const frameworkSchema = z.enum(["react", "vue"]);
export type Framework = z.infer<typeof frameworkSchema>;

const creditSchema = openKinds(
  z.object({ kind: z.literal("render") }),
  z.object({ kind: z.literal("argument"), callee: z.string(), index: finiteNumber }),
);
export type Credit = z.infer<typeof creditSchema>;

const sourceLocSchema = z.object({ file: z.string(), line: finiteNumber, column: finiteNumber });
export type SourceLoc = z.infer<typeof sourceLocSchema>;

const traceStepSchema = openKinds(
  z.object({ kind: z.literal("import"), specifier: z.string(), name: z.string() }),
  z.object({ kind: z.literal("tag"), written: z.string() }),
  z.object({ kind: z.literal("hoc"), callee: z.string() }),
  z.object({ kind: z.literal("lazy"), callee: z.string() }),
  z.object({ kind: z.literal("dynamic-map"), mapName: z.string(), mapLoc: sourceLocSchema }),
  z.object({ kind: z.literal("helper-call"), callee: z.string(), calleeFile: z.string() }),
  z.object({ kind: z.literal("prop-forward"), bindingName: z.string(), constructionSite: sourceLocSchema }),
);
export type TraceStep = z.infer<typeof traceStepSchema>;

/** The codes this scanner writes for a `chain-bailed` reason. The scan file's list is open. */
export type ChainBailedCode = "cycle-detected" | "chain-too-deep";

const unresolvedReasonSchema = openKinds(
  z.object({ kind: z.literal("package-not-installed"), packageName: nonEmptyString }),
  z.object({ kind: z.literal("module-not-found") }),
  z.object({ kind: z.literal("unbound-name"), name: nonEmptyString }),
  z.object({ kind: z.literal("chain-bailed"), code: openValue }),
);
export type UnresolvedReason = z.infer<typeof unresolvedReasonSchema>;

const resolutionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("resolved"), componentId: z.string() }),
  z.object({
    status: z.literal("unresolved"),
    reason: unresolvedReasonSchema,
    /** Never present on an unresolved occurrence. */
    componentId: z.never().optional(),
  }),
]);
export type Resolution = z.infer<typeof resolutionSchema>;

/**
 * Per-occurrence prop value (keyed by prop name on an occurrence's `props`).
 * Same tiers as PropUsage minus `name`. Absent prop → key omitted.
 */
export type PropValueState =
  | { tier: "written"; value: string | number | boolean | null }
  | { tier: "written"; valueSet: (string | number | boolean)[] }
  | { tier: "reference"; ref: string }
  | { tier: "dynamic" };

const occurrenceSchema = z.object({
  occurrenceId: nonEmptyString,
  resolution: resolutionSchema,
  filePath: z.string(),
  line: finiteNumber,
  column: finiteNumber,
  credit: creditSchema,
  trace: z.array(traceStepSchema),
  /**
   * The reference the file renders the component through, with its member path (`SettingsHeader`,
   * `Filters.FilterBar`). Present only when it names the component differently from its declaration.
   */
  writtenName: nonEmptyString.optional(),
  props: z.record(z.string(), plainObject<PropValueState>()),
  events: z.array(z.string()).optional(),
  ownerComponentId: z.string().optional(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;
export type ResolvedOccurrence = Occurrence & { resolution: { status: "resolved"; componentId: string } };

const attributionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("package"), packageName: nonEmptyString }),
  z.object({ kind: z.literal("repository"), ...repositoryDeclarationFields }),
]);
export type AttributionTarget = z.infer<typeof attributionTargetSchema>;

const evidenceRecordSchema = z.object({
  source: openValue,
  strength: openValue,
  /** Repository-relative file, or a package coordinate. Never an absolute path. */
  locator: z.union([
    z.object({ filePath: z.string(), line: finiteNumber }),
    z.object({ packageName: z.string(), version: z.string().nullable() }),
  ]),
  target: attributionTargetSchema.optional(),
  disposition: openValue,
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

/** An evidence record as this scanner writes it: `source`, `strength` and `disposition` hold only values it knows. */
export type KnownEvidenceRecord = EvidenceRecord & {
  source: "registration" | "global-declaration" | "cem";
  strength: "observed" | "declared";
  disposition: "supports" | "candidate" | "contradicts" | "unresolved";
};

const tagAttributionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("resolved"),
    target: attributionTargetSchema,
    confidence: openValue,
    evidence: z.array(evidenceRecordSchema),
  }),
  z.object({ status: z.literal("unknown"), reason: openValue, evidence: z.array(evidenceRecordSchema) }),
  z.object({
    status: z.literal("conflict"),
    strongestClass: openValue,
    candidates: z.array(attributionTargetSchema),
    evidence: z.array(evidenceRecordSchema),
  }),
]);
export type TagAttribution = z.infer<typeof tagAttributionSchema>;

/** A tag attribution as this scanner writes it: its open values and its evidence hold only values it knows. */
export type KnownTagAttribution = { evidence: KnownEvidenceRecord[] } & (
  | (Extract<TagAttribution, { status: "resolved" }> & { confidence: KnownEvidenceRecord["strength"] })
  | (Extract<TagAttribution, { status: "unknown" }> & { reason: "absent" | "unresolved" })
  | (Extract<TagAttribution, { status: "conflict" }> & { strongestClass: KnownEvidenceRecord["strength"] })
);

/** One enumerable value bucket in a component-grain prop distribution. */
export type PropValueEntry =
  | { provenance: "written"; value: string | number | boolean | null; count: number }
  | { provenance: "written"; valueSet: (string | number | boolean)[]; count: number }
  | { provenance: "reference"; ref: string; count: number };

const propDistributionSchema = z.object({
  values: z.array(plainObject<PropValueEntry>()),
  dynamic: finiteNumber,
  omitted: finiteNumber,
  other: finiteNumber.optional(),
  truncated: finiteNumber.optional(),
});
export type PropDistribution = z.infer<typeof propDistributionSchema>;

/**
 * One prop in a source-derived declared API. Every field is explicit-only:
 * present iff the declaration site literally states it.
 */
export type DeclaredProp = {
  /** Inline type annotation as verbatim source text (Vue type-literal only;
   *  absent for React, where a destructure exposes no reliable type). */
  type?: string;
  /** Optionality when stated. Vue: from the `?` marker. React: `false` when the
   *  prop has any default (a default makes it optional); otherwise absent. */
  required?: boolean;
  /** Literal default value, when the default is a literal. Same union as
   *  `PropValueEntry.value`, so it stringifies identically to observed written
   *  values. Absent for no default or a non-literal default. */
  default?: string | number | boolean | null;
};

/**
 * Source-derived declared prop API for a local component. Absent on a
 * component when the declaration site is unreadable (see readability gate).
 */
export type DeclaredPropApi = {
  /** Prop name → what the site explicitly states. Keys in source order. */
  props: Record<string, DeclaredProp>;
  /** Component destructures `...rest` / declares an index signature. */
  hasRest: boolean;
};

export type CompositionRollup = {
  /** child componentId → count of occurrences owned by this component (owner-edge children). */
  rendersByCount: Record<string, number>;
  /** parent componentId → count of occurrences in which this component is owned by that parent. */
  renderedByCount: Record<string, number>;
  /** # of this component's occurrences with no ownerComponentId. */
  isRootCount: number;
  /** # of this component's occurrences whose component has empty rendersByCount. */
  isLeafCount: number;
};

const componentSchema = z
  .object({
    id: z.string(),
    identity: identitySchema,
    /** Package exports and repository declarations only; absent on tags. */
    framework: frameworkSchema.optional(),
    /** Tag identities only; computed from this scan's evidence. */
    attribution: tagAttributionSchema.optional(),
    stats: z.object({ occurrenceCount: finiteNumber, fileCount: finiteNumber }),
    usage: z.enum(["direct", "root", "none"]),
    props: z.record(z.string(), propDistributionSchema),
    events: z.record(z.string(), z.object({ boundCount: finiteNumber })).optional(),
    /** The distinct `writtenName` values of the component's occurrences, most used first. Absent when none. */
    writtenNames: z.array(nonEmptyString).optional(),
    composition: plainObject<CompositionRollup>(),
    /** Repository declarations only. */
    declared: plainObject<DeclaredPropApi>().optional(),
    /** Repository declarations only: declaration position in `identity.filePath`. */
    definition: z.object({ line: finiteNumber, column: finiteNumber }).optional(),
    /** Repository declarations only: owning workspace package name. */
    owningPackage: z.string().optional(),
    version: z.string().nullable(),
  })
  .superRefine((component, ctx) => {
    const onTag = component.identity.kind === "tag";
    if (component.id !== componentKey(component.identity)) fail(ctx, ["id"]);
    if (component.attribution !== undefined && !onTag) fail(ctx, ["attribution"]);
    if (onTag ? component.framework !== undefined : component.framework === undefined) fail(ctx, ["framework"]);
  });
export type Component = z.infer<typeof componentSchema>;

const scanMetaSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Package name of the CLI that wrote the scan, such as `@scoutui/cli`. Scans written before Scout don't have it. */
  scannerName: nonEmptyString.optional(),
  scannerVersion: z.string(),
  scanId: nonEmptyString,
  scannedAt: timestamp,
  repo: z.object({
    id: nonEmptyString,
    gitRemote: z.string().nullable(),
    commit: nonEmptyString,
    /** The committer date of `commit`. */
    committedAt: timestamp,
    /** How many commits the tracked branch's first-parent chain has up to and including `commit`. */
    branchPosition: z.number().int().nonnegative().optional(),
    initialCommit: z.string().nullable(),
    branch: z.string().nullable(),
  }),
});
export type ScanMeta = z.infer<typeof scanMetaSchema>;

/** A diagnostic as the scan file stores it: each code's other fields belong to the scanner that wrote it. */
export type ScanDiagnostic = { code: string; severity: "info" | "warning" };

/** The whole artefact: component ids and occurrence ids are unique, and a resolved occurrence names a listed component. */
export const artifactSchema = z
  .object({
    meta: scanMetaSchema,
    components: z.array(componentSchema),
    occurrences: z.array(occurrenceSchema),
    diagnostics: z.array(plainObject<ScanDiagnostic>()),
  })
  .superRefine((artifact, ctx) => {
    const componentIds = new Set<string>();
    for (const [index, component] of artifact.components.entries()) {
      if (componentIds.has(component.id)) fail(ctx, ["components", index, "id"]);
      componentIds.add(component.id);
    }
    const occurrenceIds = new Set<string>();
    for (const [index, { occurrenceId, resolution }] of artifact.occurrences.entries()) {
      if (occurrenceIds.has(occurrenceId)) fail(ctx, ["occurrences", index, "occurrenceId"]);
      occurrenceIds.add(occurrenceId);
      if (resolution.status === "resolved" && !componentIds.has(resolution.componentId)) {
        fail(ctx, ["occurrences", index, "resolution", "componentId"]);
      }
    }
  });
/** The whole scan file. `D` narrows `diagnostics` to the codes a scanner writes. */
export type ScanArtifact<D extends ScanDiagnostic = ScanDiagnostic> = Omit<z.infer<typeof artifactSchema>, "diagnostics"> & {
  diagnostics: D[];
};
