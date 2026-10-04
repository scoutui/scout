"use server";
import { revalidatePath } from "next/cache";
import {
  type GovernanceConflict,
  type GovernanceInput,
  GovernanceInputSchema,
  type GovernanceRecord,
  GovernanceTargetConflictError,
  conflictMessage,
  validateGovernanceInput,
} from "@scoutui/web-shared";
import { requireEditor } from "@/lib/identity";
import { getStorage } from "@/lib/storage";

// Governance changes the derived `deprecated` everywhere, so revalidate the same surfaces tags do, plus /governance.
function revalidateAll() {
  revalidatePath("/governance");
  revalidatePath("/packages");
  // Layout scope covers the dynamic per-component detail pages, which render
  // migration status.
  revalidatePath("/components", "layout");
  revalidatePath("/charts");
  revalidatePath("/repos", "layout");
}

export type SaveGovernanceResult =
  | { ok: true; id: string }
  | { ok: false; error: string; conflict?: GovernanceConflict };

export async function saveGovernance(untrusted: GovernanceInput): Promise<SaveGovernanceResult> {
  const gate = await requireEditor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = GovernanceInputSchema.safeParse(untrusted);
  if (!parsed.success) return { ok: false, error: "Couldn't save the record. Reload the page and try again." };
  const input = parsed.data;

  const storage = getStorage();
  const existing = await storage.listGovernance();
  const conflict = validateGovernanceInput(input, existing);
  if (conflict) return { ok: false, error: conflictMessage(conflict), conflict };

  let saved: GovernanceRecord;
  try {
    saved = input.id
      ? await storage.updateGovernance(input.id, input, gate.userId)
      : await storage.createGovernance(input, gate.userId);
  } catch (err) {
    // The database constraint is the final check: a collision here means a
    // concurrent write landed after the validation above.
    if (err instanceof GovernanceTargetConflictError) {
      return { ok: false, error: "Someone else just saved a record for this. Reload and try again." };
    }
    throw err;
  }

  revalidateAll();
  return { ok: true, id: saved.id };
}

export async function deleteGovernance(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  await getStorage().deleteGovernance(id);
  revalidateAll();
  return { ok: true };
}
