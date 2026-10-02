"use server";
import { revalidatePath } from "next/cache";
import {
  type GovernanceConflict,
  type GovernanceInput,
  GovernanceInputSchema,
  GovernanceTargetConflictError,
  conflictMessage,
  validateGovernanceInput,
} from "@scoutui/web-shared";
import { auth } from "@/auth";
import { getStorage } from "@/lib/storage";

async function requireUser(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not_authenticated" };
  return { ok: true };
}

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
  | { ok: true }
  | { ok: false; error: string; conflict?: GovernanceConflict };

export async function saveGovernance(untrusted: GovernanceInput): Promise<SaveGovernanceResult> {
  const gate = await requireUser();
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = GovernanceInputSchema.safeParse(untrusted);
  if (!parsed.success) return { ok: false, error: "Couldn't save the record. Reload the page and try again." };
  const input = parsed.data;

  const storage = getStorage();
  const existing = await storage.listGovernance();
  const conflict = validateGovernanceInput(input, existing);
  if (conflict) return { ok: false, error: conflictMessage(conflict), conflict };

  try {
    if (input.id) await storage.updateGovernance(input.id, input);
    else await storage.createGovernance(input);
  } catch (err) {
    // The database constraint is the final check: a collision here means a
    // concurrent write landed after the validation above.
    if (err instanceof GovernanceTargetConflictError) {
      return { ok: false, error: "Someone else just saved a record for this. Reload and try again." };
    }
    throw err;
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteGovernance(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  await getStorage().deleteGovernance(id);
  revalidateAll();
  return { ok: true };
}
