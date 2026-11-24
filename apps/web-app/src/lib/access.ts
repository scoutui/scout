import type { Dashboard } from "@scoutui/web-shared";

export const ROLES = ["viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAMES: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };
/**
 * Where a person's role comes from: the People page, `SCOUTUI_ADMINS`, `SCOUTUI_ADMIN_GROUP` or `SCOUTUI_EDITOR_GROUP`,
 * or, with `SCOUTUI_ROLES_FROM_GROUPS_ONLY` on, being in neither group, which makes them a Viewer.
 */
export type RoleSource = "people" | "install" | "group" | "no-group";
export type Person = { kind: "person"; userId: string; email: string; name: string | null; role: Role; roleSource: RoleSource };
/**
 * Who is asking, with their role as it stands for this request. `repo-token` is a repo's CI upload token, which uploads
 * only scans of `repoId`. `guest` is a browser without a session on a dashboard with `SCOUTUI_GUEST_VIEW` on.
 */
export type Identity = Person | { kind: "repo-token"; repoId: string } | { kind: "guest" };
export type Action = "view" | "edit" | "upload" | "manage-people" | "manage-repos";
/** The parts of a saved chart its access depends on. */
export type ChartTarget = Pick<Dashboard, "createdByUserId" | "visibility">;
/** What an action is about: a repo, or a saved chart. */
export type Target = { repoId: string } | { chart: ChartTarget };

export const EDIT_REFUSAL = "Only Editors can make changes. Ask an Admin for access.";
export const UPLOAD_REFUSAL = {
  code: "upload_not_allowed",
  message: "You can view this dashboard but not upload to it. Ask an Admin to make you an Editor.",
} as const;
export const ADMIN_REFUSAL = "Only Admins can change roles. Ask an Admin for access.";
export const REPO_ADMIN_REFUSAL = "Only Admins can remove scans and delete repos. Ask an Admin for access.";
export const CHART_REFUSAL = "Only the chart's creator or an Admin can change it.";

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
const NEEDS: Record<Exclude<Action, "view">, Role> = { edit: "editor", upload: "editor", "manage-people": "admin", "manage-repos": "admin" };

/**
 * Whether `identity` may do `action` to `target`. Everyone signed in, and a guest, may view a chart shared with
 * everyone; only its creator and Admins may view a private one, or edit or delete any chart. A guest may only view.
 */
export function can(identity: Identity | null, action: Action, target?: Target): boolean {
  if (identity === null) return false;
  if (identity.kind === "repo-token") return action === "upload" && !(target && "repoId" in target && target.repoId !== identity.repoId);
  if (identity.kind === "guest") return action === "view" && !(target && "chart" in target && target.chart.visibility !== "everyone");
  const chart = target && "chart" in target ? target.chart : null;
  const ownsOrAdmin = chart === null || chart.createdByUserId === identity.userId || identity.role === "admin";
  if (action === "view") return chart?.visibility === "everyone" || ownsOrAdmin;
  if (RANK[identity.role] < RANK[NEEDS[action]]) return false;
  return action !== "edit" || ownsOrAdmin;
}

export type RoleSettings = { adminEmails: ReadonlySet<string>; adminGroup: string | null; editorGroup: string | null; groupsOnly: boolean };

function groupSetting(value: string | undefined): string | null {
  const group = value?.trim() ?? "";
  return group === "" ? null : group;
}

/**
 * `SCOUTUI_ADMINS` (comma-separated emails, compared case-insensitively), `SCOUTUI_ADMIN_GROUP`, `SCOUTUI_EDITOR_GROUP`,
 * and whether `SCOUTUI_ROLES_FROM_GROUPS_ONLY` is `true`.
 */
export function roleSettings(env: Record<string, string | undefined> = process.env): RoleSettings {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const emails = (env["SCOUTUI_ADMINS"] ?? "").split(",").map(e => e.trim().toLowerCase()).filter(e => e !== "");
  return {
    adminEmails: new Set(emails),
    // biome-ignore lint/complexity/useLiteralKeys: env access
    adminGroup: groupSetting(env["SCOUTUI_ADMIN_GROUP"]),
    // biome-ignore lint/complexity/useLiteralKeys: env access
    editorGroup: groupSetting(env["SCOUTUI_EDITOR_GROUP"]),
    // biome-ignore lint/complexity/useLiteralKeys: env access
    groupsOnly: env["SCOUTUI_ROLES_FROM_GROUPS_ONLY"] === "true",
  };
}

/** Whether `SCOUTUI_GUEST_VIEW` is `true`, letting browsers without a session view the dashboard. */
export function guestViewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  return env["SCOUTUI_GUEST_VIEW"] === "true";
}

/**
 * Throws when `SCOUTUI_ROLES_FROM_GROUPS_ONLY` is set to anything but `true` or `false`, unless `SCOUTUI_ADMINS` or
 * `SCOUTUI_ADMIN_GROUP` is set, and, with `SCOUTUI_ROLES_FROM_GROUPS_ONLY` on, unless `SCOUTUI_ADMIN_GROUP` or
 * `SCOUTUI_EDITOR_GROUP` is set.
 */
export function requireRoleSettings(env: Record<string, string | undefined>): void {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const groupsOnlyValue = env["SCOUTUI_ROLES_FROM_GROUPS_ONLY"];
  if (groupsOnlyValue !== undefined && groupsOnlyValue !== "" && groupsOnlyValue !== "true" && groupsOnlyValue !== "false") {
    throw new Error(`Set SCOUTUI_ROLES_FROM_GROUPS_ONLY to true or false, not "${groupsOnlyValue}".`);
  }
  const { adminEmails, adminGroup, editorGroup, groupsOnly } = roleSettings(env);
  if (adminEmails.size === 0 && adminGroup === null) {
    throw new Error("Set SCOUTUI_ADMINS to your admins' email addresses, or SCOUTUI_ADMIN_GROUP to a group in your sign-in provider.");
  }
  if (groupsOnly && adminGroup === null && editorGroup === null) {
    throw new Error("SCOUTUI_ROLES_FROM_GROUPS_ONLY is on, so set SCOUTUI_ADMIN_GROUP or SCOUTUI_EDITOR_GROUP to a group in your sign-in provider.");
  }
}

export type PersonRow = {
  id: string; email: string; name: string | null; emailVerified: Date | null; role: Role | null; adminGroup: string | null; editorGroup: string | null;
};

/**
 * The person `row` describes, with their role, or null when they were removed. The highest role wins: an Admin named
 * in `SCOUTUI_ADMINS`, then the admin group, then an Admin set on the People page, then the editor group, then the role
 * set on the People page. With `SCOUTUI_ROLES_FROM_GROUPS_ONLY` on, roles set on the People page don't count, and
 * someone in neither group is a Viewer.
 */
export function personIdentity(row: PersonRow, settings: RoleSettings): Person | null {
  if (row.role === null) return null;
  const person = { kind: "person" as const, userId: row.id, email: row.email, name: row.name };
  if (row.emailVerified !== null && settings.adminEmails.has(row.email.toLowerCase())) return { ...person, role: "admin", roleSource: "install" };
  if (settings.adminGroup !== null && row.adminGroup === settings.adminGroup) return { ...person, role: "admin", roleSource: "group" };
  if (!settings.groupsOnly && row.role === "admin") return { ...person, role: "admin", roleSource: "people" };
  if (settings.editorGroup !== null && row.editorGroup === settings.editorGroup) return { ...person, role: "editor", roleSource: "group" };
  if (settings.groupsOnly) return { ...person, role: "viewer", roleSource: "no-group" };
  return { ...person, role: row.role, roleSource: "people" };
}
