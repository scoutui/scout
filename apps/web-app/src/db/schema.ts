import { pgTable, text, timestamp, json, jsonb, index, unique, primaryKey, integer, boolean, bigint, check, customType, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { DashboardConfig, Disposition, RepoViewRow, ComponentFactRow, PackageContributionRow, DetailRow, OccurrenceModelRow, GraphRow } from "@scoutui/web-shared";

export const repos = pgTable("repos", {
  repoId: text("repo_id").primaryKey(),
  gitRemote: text("git_remote"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Must be explicitly SET in ON CONFLICT DO UPDATE; defaultNow() only fires on INSERT.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scans = pgTable(
  "scans",
  {
    scanId: text("scan_id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.repoId, { onDelete: "cascade" }),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
    commitSha: text("commit_sha").notNull(),
    branch: text("branch"),
    branchPosition: integer("branch_position"),
    scanner: text("scanner"),
    scannerVersion: text("scanner_version").notNull(),
    artifact: json("artifact").$type<unknown>(),
    sourceUploadId: text("source_upload_id").references((): AnyPgColumn => scanUploads.uploadId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    repoCommittedDesc: index("scans_repo_committed_at_desc").on(t.repoId, t.committedAt.desc()),
    committedDesc: index("scans_committed_at_desc").on(t.committedAt.desc()),
    repoCommit: uniqueIndex("scans_repo_commit").on(t.repoId, t.commitSha),
  }),
);

export const scanReadModels = pgTable("scan_read_models", {
  scanId: text("scan_id").primaryKey().references(() => scans.scanId, { onDelete: "cascade" }),
  projectionVersion: integer("projection_version").notNull(),
  formatVersion: integer("format_version").notNull(),
  state: text("state", { enum: ["ready"] }).notNull(),
  buildRevision: integer("build_revision").notNull(),
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
  expectedCounts: jsonb("expected_counts").$type<Record<string, number>>().notNull(),
  actualCounts: jsonb("actual_counts").$type<Record<string, number>>().notNull(),
  detailsRetained: boolean("details_retained").notNull(),
});

export const scanRepoViews = pgTable("scan_repo_views", {
  scanId: text("scan_id").primaryKey().references(() => scans.scanId, { onDelete: "cascade" }),
  repoId: text("repo_id").notNull(),
  sourceOrdinal: integer("source_ordinal").notNull(),
  payload: jsonb("payload").$type<RepoViewRow>().notNull(),
});

export const scanComponentFacts = pgTable("scan_component_facts", {
  scanId: text("scan_id").notNull().references(() => scans.scanId, { onDelete: "cascade" }),
  componentId: text("component_id").notNull(),
  packageName: text("package_name"),
  filePath: text("file_path"),
  sourceOrdinal: integer("source_ordinal").notNull(),
  payload: jsonb("payload").$type<ComponentFactRow>().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.scanId, t.componentId] }),
  package: index("scan_component_facts_package").on(t.scanId, t.packageName, t.sourceOrdinal),
  ordinal: index("scan_component_facts_ordinal").on(t.scanId, t.sourceOrdinal),
}));

export const scanPackageContributions = pgTable("scan_package_contributions", {
  scanId: text("scan_id").notNull().references(() => scans.scanId, { onDelete: "cascade" }),
  packageName: text("package_name").notNull(),
  componentId: text("component_id").notNull(),
  sourceOrdinal: integer("source_ordinal").notNull(),
  payload: jsonb("payload").$type<PackageContributionRow>().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.scanId, t.packageName, t.componentId] }),
  ordinal: index("scan_package_contributions_ordinal").on(t.scanId, t.packageName, t.sourceOrdinal),
}));

export const scanComponentDetails = pgTable("scan_component_details", {
  scanId: text("scan_id").notNull().references(() => scans.scanId, { onDelete: "cascade" }),
  selector: text("selector").notNull(),
  sourceOrdinal: integer("source_ordinal").notNull(),
  payload: jsonb("payload").$type<DetailRow>().notNull(),
}, t => ({ pk: primaryKey({ columns: [t.scanId, t.selector] }) }));

export const scanOccurrenceViews = pgTable("scan_occurrence_views", {
  scanId: text("scan_id").notNull().references(() => scans.scanId, { onDelete: "cascade" }),
  componentId: text("component_id").notNull(),
  filePath: text("file_path").notNull(),
  sourceOrdinal: integer("source_ordinal").notNull(),
  payload: jsonb("payload").$type<OccurrenceModelRow>().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.scanId, t.sourceOrdinal] }),
  component: index("scan_occurrence_views_component").on(t.scanId, t.componentId, t.sourceOrdinal),
  file: index("scan_occurrence_views_file").on(t.scanId, t.filePath, t.sourceOrdinal),
}));

export const scanCompositionGraphs = pgTable("scan_composition_graphs", {
  scanId: text("scan_id").notNull().references(() => scans.scanId, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["graph-node", "graph-edge"] }).notNull(),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id"),
  sourceOrdinal: integer("source_ordinal").notNull(),
  payload: jsonb("payload").$type<GraphRow>().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.scanId, t.kind, t.sourceOrdinal] }),
  source: index("scan_composition_graphs_source").on(t.scanId, t.kind, t.sourceId),
  target: index("scan_composition_graphs_target").on(t.scanId, t.kind, t.targetId),
}));

// --- Auth.js v5 tables (adapter-expected shape) ---

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  role: text("role", { enum: ["viewer", "editor", "admin"] }).default("viewer"),
  lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),
  adminGroup: text("admin_group"),
}, (t) => ({
  role: check("user_role", sql`${t.role} IN ('viewer', 'editor', 'admin')`),
}));

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

// --- CLI auth tables ---

export const cliSessions = pgTable(
  "cli_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byUser: index("cli_sessions_user_id").on(t.userId) }),
);

export const cliDeviceCodes = pgTable("cli_device_codes", {
  id: text("id").primaryKey(),
  deviceCodeHash: text("device_code_hash").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  status: text("status", { enum: ["pending", "approved", "consumed", "denied"] }).notNull().default("pending"),
  approvedUserId: text("approved_user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
});

// --- Package tags (org-scoped, web-authored) ---

export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  category: text("category"), // "library", or null for a plain label
  color: text("color").notNull(),
  rule: jsonb("rule").$type<{ glob: string[]; exact: string[] }>().notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: text("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  color: check("tags_color", sql`${t.color} IN ('teal', 'violet', 'blue', 'berry', 'orchid')`),
}));

export type TagRow = typeof tags.$inferSelect;

// --- Saved dashboards (cohort charts, visible to everyone) ---

export const dashboards = pgTable("dashboards", {
  id: text("id").primaryKey(), // app-generated uuid at insert (mirrors tags)
  name: text("name").notNull(),
  description: text("description"),
  config: jsonb("config").$type<DashboardConfig>().notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DashboardRow = typeof dashboards.$inferSelect;

// --- Governance lifecycle (web-authored) ---

export const governance = pgTable(
  "governance",
  {
    id: text("id").primaryKey(),
    grain: text("grain", { enum: ["package", "component"] }).notNull(),
    targetPackage: text("target_package").notNull(),
    targetExport: text("target_export"), // null = whole-package grain
    disposition: jsonb("disposition").$type<Disposition>().notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One verdict per source. target_export NULL = package grain (NULLS NOT DISTINCT).
    uniqueTarget: unique("governance_target").on(t.targetPackage, t.targetExport).nullsNotDistinct(),
  }),
);
export type GovernanceRow = typeof governance.$inferSelect;

export const roleChanges = pgTable("role_changes", {
  id: text("id").primaryKey(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  actorEmail: text("actor_email").notNull(),
  subjectEmail: text("subject_email").notNull(),
  fromRole: text("from_role", { enum: ["viewer", "editor", "admin"] }).notNull(),
  toRole: text("to_role", { enum: ["viewer", "editor", "admin"] }),
}, (t) => ({
  changedAt: index("role_changes_changed_at").on(t.changedAt.desc()),
}));
export type RoleChangeRow = typeof roleChanges.$inferSelect;

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

export type RepoRow = typeof repos.$inferSelect;
export type ScanRow = typeof scans.$inferSelect;
export type CliSessionRow = typeof cliSessions.$inferSelect;
export type CliDeviceCodeRow = typeof cliDeviceCodes.$inferSelect;

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const scanUploads = pgTable("scan_uploads", {
  uploadId: text("upload_id").primaryKey(),
  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  encoding: text("encoding", { enum: ["gzip"] }).notNull(),
  storedBytes: bigint("stored_bytes", { mode: "number" }).notNull().default(0),
  checksum: text("checksum"),
  scanId: text("scan_id").references((): AnyPgColumn => scans.scanId, { onDelete: "set null" }),
  state: text("state", { enum: ["receiving", "queued", "processing", "ready", "duplicate", "failed"] }).notNull().default("receiving"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  replaced: boolean("replaced").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  encoding: check("scan_uploads_encoding", sql`${t.encoding} = 'gzip'`),
  bytes: check("scan_uploads_stored_bytes", sql`${t.storedBytes} >= 0`),
  state: check("scan_uploads_state", sql`${t.state} IN ('receiving', 'queued', 'processing', 'ready', 'duplicate', 'failed')`),
}));

export const scanArtifactChunks = pgTable("scan_artifact_chunks", {
  uploadId: text("upload_id").notNull().references(() => scanUploads.uploadId, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  bytes: bytea("bytes").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.uploadId, t.ordinal] }),
  ordinal: check("scan_artifact_chunks_ordinal", sql`${t.ordinal} >= 0`),
  size: check("scan_artifact_chunks_size", sql`octet_length(${t.bytes}) BETWEEN 1 AND 1048576`),
}));

export const scanJobs = pgTable("scan_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["upload", "scan", "results"] }).notNull(),
  uploadId: text("upload_id").references(() => scanUploads.uploadId, { onDelete: "cascade" }),
  scanId: text("scan_id").references(() => scans.scanId, { onDelete: "cascade" }),
  projectionVersion: integer("projection_version").notNull(),
  state: text("state", { enum: ["queued", "processing", "ready", "failed"] }).notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  priority: integer("priority").notNull().default(0),
  sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  repair: boolean("repair").notNull().default(false),
  rescan: boolean("rescan").notNull().default(false),
  leaseToken: text("lease_token"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  kind: check("scan_jobs_kind", sql`${t.kind} IN ('upload', 'scan', 'results')`),
  target: check("scan_jobs_target", sql`(${t.kind} = 'upload') = (${t.uploadId} IS NOT NULL) AND (${t.kind} = 'scan') = (${t.scanId} IS NOT NULL)`),
  version: check("scan_jobs_version", sql`${t.projectionVersion} > 0`),
  attempts: check("scan_jobs_attempts", sql`${t.attempts} >= 0`),
  state: check("scan_jobs_state", sql`${t.state} IN ('queued', 'processing', 'ready', 'failed')`),
  uploadVersion: uniqueIndex("scan_jobs_upload_version").on(t.uploadId, t.projectionVersion).where(sql`${t.uploadId} IS NOT NULL`),
  scanVersion: uniqueIndex("scan_jobs_scan_version").on(t.scanId, t.projectionVersion).where(sql`${t.scanId} IS NOT NULL`),
  claim: index("scan_jobs_claim").on(t.priority.desc(), t.availableAt, t.sequence).where(sql`${t.state} IN ('queued', 'processing')`),
  resultsQueued: uniqueIndex("scan_jobs_results_queued").on(t.kind).where(sql`${t.kind} = 'results' AND ${t.state} = 'queued'`),
}));

export const chartResults = pgTable("chart_results", {
  key: text("key").primaryKey(),
  resultsVersion: integer("results_version").notNull(),
  formatVersion: integer("format_version").notNull(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
  payload: json("payload").notNull(),
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
});
