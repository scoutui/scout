import type { Pool } from "pg";

/** Inserts a person and returns their id. */
export async function insertPerson(pool: Pool, person: {
  email: string; role?: "viewer" | "editor" | "admin" | null; verified?: boolean; adminGroup?: string | null; name?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO "user" (id, email, name, role, "emailVerified", admin_group) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, person.email, person.name ?? null, person.role === undefined ? "viewer" : person.role, person.verified ? new Date() : null, person.adminGroup ?? null],
  );
  return id;
}
