"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/ui/brand-mark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const TABS = [
  { href: "/repos", label: "repos" },
  { href: "/packages", label: "packages" },
  { href: "/charts", label: "charts" },
  { href: "/governance", label: "governance" },
] as const;

type Tab = (typeof TABS)[number];

const isActive = (pathname: string, tab: Tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`);

export function TopTabs({ showGovernance, rightSlot }: { showGovernance: boolean; rightSlot?: React.ReactNode }) {
  const pathname = usePathname();
  // Every other route needs sign-in, so on /login the tabs would only lead
  // back to /login.
  if (pathname === "/login") return null;
  const tabs = TABS.filter((t) => showGovernance || t.href !== "/governance");
  return (
    <nav className="sticky top-0 z-30 border-b border-border/70 bg-background">
      <div className="mx-auto flex h-14 max-w-[1600px] items-stretch px-4 sm:px-8 lg:px-10">
        <Link
          href="/repos"
          className="mr-5 sm:mr-9 inline-flex shrink-0 items-center gap-2.5 font-wordmark text-sm font-semibold tracking-[0.02em] text-foreground transition-colors hover:text-foreground/80"
        >
          <BrandMark />
          <span className="max-sm:sr-only">Scout</span>
        </Link>
        <PageMenu tabs={tabs} pathname={pathname} />
        {/* Tab rail. The active tab's underline overlaps the nav's border
            (-mb-px). The rail scrolls if the tabs ever outgrow it, so the
            right cluster never clips. */}
        <div className="hidden min-w-0 items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex">
          {tabs.map((t) => {
            const active = isActive(pathname, t);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative -mb-px inline-flex h-full shrink-0 items-center border-b-2 px-3.5 text-sm transition-colors",
                  "focus-visible:rounded-sm focus-inset",
                  active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        {rightSlot ? <div className="ml-auto flex shrink-0 items-center pl-4">{rightSlot}</div> : null}
      </div>
    </nav>
  );
}

function PageMenu({ tabs, pathname }: { tabs: readonly Tab[]; pathname: string }) {
  const current = tabs.find((t) => isActive(pathname, t));
  return (
    <div className="-ml-2 flex items-center sm:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted active:bg-accent aria-expanded:bg-muted">
          {current?.label ?? "menu"}
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {tabs.map((t) => {
            const active = t === current;
            return (
              <DropdownMenuLinkItem
                key={t.href}
                closeOnClick
                render={<Link href={t.href} aria-current={active ? "page" : undefined} />}
                className={cn("h-10 gap-2.5 px-2.5", active ? "font-medium text-foreground" : "text-muted-foreground")}
              >
                <Check aria-hidden className={cn("size-4", active ? "opacity-100" : "opacity-0")} />
                {t.label}
              </DropdownMenuLinkItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
