"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { can, type Person, ROLE_NAMES } from "@/lib/access";
import { cn } from "@/lib/utils";
import { CURRENT_PAGE, isUnder } from "@/components/nav/top-tabs";
import { type Theme, useTheme } from "@/components/theme/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function initials({ name, email }: Person): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const letters = words.length > 0 ? words.slice(0, 2).map(word => word[0]).join("") : email.slice(0, 1);
  return letters.toUpperCase();
}

export function AccountMenu({ person }: { person: Person | null }) {
  const { theme, setTheme } = useTheme();
  const onSettings = isUnder(usePathname(), "/settings");
  if (!person) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {initials(person)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-sm">
            {person.name ? <p className="font-medium wrap-anywhere">{person.name}</p> : null}
            <p className="text-muted-foreground wrap-anywhere">{person.email}</p>
            <p className="text-muted-foreground">{ROLE_NAMES[person.role]}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-label text-muted-foreground">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value: Theme) => setTheme(value)}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value} closeOnClick={false}>
                {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {can(person, "manage-people") ? (
            <DropdownMenuLinkItem
              closeOnClick
              render={<Link href="/settings" aria-current={onSettings ? "page" : undefined} />}
              className={cn(onSettings && CURRENT_PAGE)}
            >
              Settings
            </DropdownMenuLinkItem>
          ) : null}
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
