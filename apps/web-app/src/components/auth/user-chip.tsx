import { auth } from "@/auth";
import { SignOutButton } from "./sign-out-button";

export async function UserChip() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="hidden sm:inline text-muted-foreground">{session.user.email}</span>
      <span aria-hidden className="hidden sm:inline text-muted-foreground/40">
        ·
      </span>
      <SignOutButton />
    </div>
  );
}
