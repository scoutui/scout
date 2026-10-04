"use client";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { can, type Person, ROLE_NAMES } from "@/lib/access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
        className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {initials(person)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 text-xs">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {person.name ? <p className="truncate font-medium">{person.name}</p> : null}
            <p className="truncate text-muted-foreground">{person.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-muted-foreground">{ROLE_NAMES[person.role]}</DropdownMenuLabel>
            {can(person, "manage-people") ? (
              <DropdownMenuLinkItem className="text-xs" closeOnClick render={<Link href="/settings" />}>
                Settings
              </DropdownMenuLinkItem>
            ) : null}
            <DropdownMenuItem className="text-xs" onClick={() => signOut({ callbackUrl: "/login" })}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
