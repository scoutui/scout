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
    <nav className="sticky top-0 z-30 h-(--top-bar-height) border-b border-border/70 bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] items-stretch px-4 sm:px-8 lg:px-10">
        <Link
          href="/repos"
          className="mr-5 sm:mr-9 inline-flex shrink-0 items-center gap-2.5 font-wordmark text-sm font-semibold tracking-[0.02em] text-foreground transition-colors hover:text-foreground/80"
        >
          <BrandMark />
          <span className="hidden sm:inline">Scout</span>
        </Link>
        {/* Tab rail. The active tab's underline overlaps the nav's border
            (-mb-px). The rail scrolls on narrow screens so the right cluster
            never clips; with the scrollbar hidden, a right-edge fade below sm
            shows there are more tabs, and trailing padding lets the last tab
            scroll clear of it. */}
        <div className="flex min-w-0 items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
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
