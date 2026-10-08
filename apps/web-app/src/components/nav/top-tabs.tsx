"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/ui/brand-mark";

const TABS = [
  { href: "/repos", label: "repos" },
  { href: "/packages", label: "packages" },
  { href: "/charts", label: "charts" },
  { href: "/governance", label: "governance" },
] as const;

export function TopTabs({ showGovernance, rightSlot }: { showGovernance: boolean; rightSlot?: React.ReactNode }) {
  const pathname = usePathname();
  // Every other route needs sign-in, so on /login the tabs would only lead
  // back to /login.
  if (pathname === "/login") return null;
  return (
    <nav className="sticky top-0 z-30 border-b border-border/70 bg-background">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-stretch px-4 sm:h-14 sm:flex-nowrap sm:px-8 lg:px-10">
        <Link
          href="/repos"
          className="mr-5 sm:mr-9 inline-flex h-14 shrink-0 items-center gap-2.5 font-wordmark text-sm font-semibold tracking-[0.02em] text-foreground transition-colors hover:text-foreground/80"
        >
          <BrandMark />
          <span className="hidden sm:inline">Scout</span>
        </Link>
        {/* Tab rail. The active tab's underline overlaps the nav's border
            (-mb-px). Below sm the rail is its own row under the logo. It
            scrolls with the scrollbar hidden when the tabs don't fit. */}
        <div className="scroll-fade-x flex min-w-0 items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:order-last max-sm:-mx-4 max-sm:h-10 max-sm:grow max-sm:basis-full max-sm:px-0.5">
          {TABS.filter((t) => showGovernance || t.href !== "/governance").map((t) => {
            const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative -mb-px inline-flex h-full shrink-0 items-center border-b-2 px-3.5 text-sm transition-colors",
                  "focus-visible:rounded-sm",
                  active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground active:border-muted-foreground active:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        {rightSlot ? <div className="ml-auto flex h-14 shrink-0 items-center pl-4">{rightSlot}</div> : null}
      </div>
    </nav>
  );
}
