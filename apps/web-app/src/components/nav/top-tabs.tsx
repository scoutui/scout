"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/ui/brand-mark";

const TABS = [
  { href: "/repos", label: "repos" },
  { href: "/packages", label: "packages" },
  { href: "/charts", label: "charts" },
  { href: "/governance", label: "governance" },
] as const;

type Tab = (typeof TABS)[number];

export const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The tab a page sits under. A component page sits under packages. */
function tabOf(pathname: string): Tab | undefined {
  const path = isUnder(pathname, "/components") ? "/packages" : pathname;
  return TABS.find((t) => isUnder(path, t.href));
}

/** The current page in a list of pages: medium weight and a bar on the row's leading edge. */
export const CURRENT_PAGE =
  "font-medium before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-foreground";

export function TopTabs({ showGovernance, rightSlot }: { showGovernance: boolean; rightSlot?: React.ReactNode }) {
  const pathname = usePathname();
  // Every other route needs sign-in, so on /login the tabs would only lead
  // back to /login.
  if (pathname === "/login") return null;
  const tabs = TABS.filter((t) => showGovernance || t.href !== "/governance");
  const current = tabOf(pathname);
  return (
    <header className="sticky top-0 z-30 h-(--top-bar-height) border-b border-border/70 bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] items-stretch px-4 sm:px-8 lg:px-10">
        <PageMenu tabs={tabs} current={current} />
        <Link
          href="/repos"
          className="mr-5 sm:mr-9 inline-flex shrink-0 items-center gap-2 sm:gap-2.5 font-wordmark text-sm font-semibold tracking-[0.02em] text-foreground transition-colors hover:text-foreground/80 focus-visible:rounded-sm focus-inset"
        >
          <BrandMark className="max-sm:ring-0" />
          Scout
        </Link>
        {/* Tab rail. The active tab's underline overlaps the header's border
            (-mb-px). The rail scrolls if the tabs ever outgrow it, so the
            right cluster never clips. */}
        <nav
          aria-label="Pages"
          className="hidden min-w-0 items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex"
        >
          {tabs.map((t) => {
            const active = t === current;
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
        </nav>
        {rightSlot ? <div className="ml-auto flex shrink-0 items-center pl-4">{rightSlot}</div> : null}
      </div>
    </header>
  );
}

/**
 * Below `sm`, the pages behind a Menu button: a panel under the header with a list of links. Escape, choosing a link,
 * moving focus out of the panel or tapping outside it closes the panel.
 */
function PageMenu({ tabs, current }: { tabs: readonly Tab[]; current: Tab | undefined }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      ref={root}
      className="-ml-2 mr-1 flex items-center sm:hidden"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        setOpen(false);
        button.current?.focus();
      }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted active:bg-accent aria-expanded:bg-muted [&_svg]:size-5"
      >
        <Menu aria-hidden />
      </button>
      <nav id={id} aria-label="Pages" hidden={!open} className="absolute inset-x-0 top-full mt-px border-b border-border/70 bg-background shadow-md">
        <ul className="px-2 py-2">
          {tabs.map((t) => {
            const active = t === current;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "relative flex h-11 items-center rounded-md px-2 text-sm text-foreground transition-colors hover:bg-muted",
                    active && CURRENT_PAGE,
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
