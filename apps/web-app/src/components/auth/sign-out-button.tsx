"use client";
import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      sign out
    </button>
  );
}
