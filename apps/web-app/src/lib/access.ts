export const ROLES = ["viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAMES: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };
/** Where a person's role comes from: the People page, `SCOUTUI_ADMINS`, or `SCOUTUI_ADMIN_GROUP`. */
export type RoleSource = "people" | "install" | "group";
export type Person = { kind: "person"; userId: string; email: string; name: string | null; role: Role; roleSource: RoleSource };
/** Who is asking, with their role as it stands for this request. `ci` is the install-wide upload secret. */
export type Identity = Person | { kind: "ci" };
export type Action = "view" | "edit" | "upload" | "manage-people" | "manage-repos";

export const EDIT_REFUSAL = "Only Editors can make changes. Ask an Admin for access.";
export const UPLOAD_REFUSAL = {
  code: "upload_not_allowed",
  message: "You can view this dashboard but not upload to it. Ask an Admin to make you an Editor.",
} as const;
export const ADMIN_REFUSAL = "Only Admins can change roles. Ask an Admin for access.";
export const REPO_ADMIN_REFUSAL = "Only Admins can remove scans and delete repos. Ask an Admin for access.";

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
const NEEDS: Record<Exclude<Action, "view">, Role> = { edit: "editor", upload: "editor", "manage-people": "admin", "manage-repos": "admin" };

/** Whether `identity` may do `action`. `repoId` is the repo the action is about, when there is one. */
export function can(identity: Identity | null, action: Action, _repoId?: string): boolean {
  if (identity === null) return false;
  if (identity.kind === "ci") return action === "upload";
  if (action === "view") return true;
  return RANK[identity.role] >= RANK[NEEDS[action]];
}

export type AdminSettings = { emails: ReadonlySet<string>; group: string | null };

/** `SCOUTUI_ADMINS` (comma-separated emails, compared case-insensitively) and `SCOUTUI_ADMIN_GROUP`. */
export function adminSettings(env: Record<string, string | undefined> = process.env): AdminSettings {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const emails = (env["SCOUTUI_ADMINS"] ?? "").split(",").map(e => e.trim().toLowerCase()).filter(e => e !== "");
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const group = env["SCOUTUI_ADMIN_GROUP"]?.trim() ?? "";
  return { emails: new Set(emails), group: group === "" ? null : group };
}

/** Throws unless `SCOUTUI_ADMINS` or `SCOUTUI_ADMIN_GROUP` is set. */
export function requireAdminSettings(env: Record<string, string | undefined>): void {
  const { emails, group } = adminSettings(env);
  if (emails.size === 0 && group === null) {
    throw new Error("Set SCOUTUI_ADMINS to your admins' email addresses, or SCOUTUI_ADMIN_GROUP to a group in your sign-in provider.");
  }
}

export type PersonRow = { id: string; email: string; name: string | null; emailVerified: Date | null; role: Role | null; adminGroup: string | null };

/** The person `row` describes, with their role, or null when they were removed. */
export function personIdentity(row: PersonRow, settings: AdminSettings): Person | null {
  if (row.role === null) return null;
  const person = { kind: "person" as const, userId: row.id, email: row.email, name: row.name };
  if (row.emailVerified !== null && settings.emails.has(row.email.toLowerCase())) return { ...person, role: "admin", roleSource: "install" };
  if (settings.group !== null && row.adminGroup === settings.group) return { ...person, role: "admin", roleSource: "group" };
  return { ...person, role: row.role, roleSource: "people" };
}
