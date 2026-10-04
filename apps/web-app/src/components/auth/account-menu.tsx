"use client";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { can, type Person, type Role } from "@/lib/access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_NAMES: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };

function initials({ name, email }: Person): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const letters = words.length > 0 ? words.slice(0, 2).map(word => word[0]).join("") : email.slice(0, 1);
  return letters.toUpperCase();
}

export function AccountMenu({ person }: { person: Person | null }) {
  if (!person) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {initials(person)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 text-xs">
        <div className="px-2 py-1.5">
          {person.name ? <p className="truncate font-medium">{person.name}</p> : null}
          <p className="truncate text-muted-foreground">{person.email}</p>
        </div>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-muted-foreground">{ROLE_NAMES[person.role]}</p>
        {can(person, "manage-people") ? (
          <DropdownMenuLinkItem className="text-xs" closeOnClick render={<Link href="/settings" />}>
            Settings
          </DropdownMenuLinkItem>
        ) : null}
        <DropdownMenuItem className="text-xs" onClick={() => signOut({ callbackUrl: "/login" })}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
