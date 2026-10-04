import type { ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { ScanFinding, ScanFindingKind } from "@scoutui/web-shared";
import { cn } from "@/lib/utils";

const DOCS = "https://scoutui.dev/docs";

const counted = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const Code = ({ children }: { children: ReactNode }) => <span className="font-mono">{children}</span>;

/** Each kind's label, its fix and the docs section that explains it. `toFix` kinds are ones the repo can change. */
const KINDS: Record<ScanFindingKind, { label: [string, string]; fix: ReactNode; docs: string; toFix: boolean }> = {
  "package-not-installed": {
    label: ["use from a package that wasn't installed", "uses from packages that weren't installed"],
    fix: "Install dependencies before the scan runs.",
    docs: "guides/troubleshoot-a-scan#dependencies-arent-installed",
    toFix: true,
  },
  "import-not-found": {
    label: ["use imports a path that couldn't be found", "uses import a path that couldn't be found"],
    fix: <>Fix the import path, or declare its alias in <Code>tsconfig.json</Code> or <Code>scout.config.json</Code>.</>,
    docs: "guides/resolve-imports-in-a-monorepo#find-imports-that-didnt-resolve",
    toFix: true,
  },
  "not-imported": {
    label: ["use of a component that isn't imported", "uses of components that aren't imported"],
    fix: "Import each component where it's used, or list it in an auto-import file.",
    docs: "guides/troubleshoot-a-scan#unresolved-occurrences",
    toFix: true,
  },
  "auto-import-missing": {
    label: ["auto-imported component wasn't found", "auto-imported components weren't found"],
    fix: <>Regenerate the auto-import list before the scan, with <Code>npx nuxt prepare</Code> or a build.</>,
    docs: "reference/diagnostics#auto-import-stale-entry",
    toFix: true,
  },
  "undefined-element": {
    label: ["undefined element", "undefined elements"],
    fix: <>Point the defining package&apos;s <Code>package.json</Code> at its <Code>custom-elements.json</Code>, or import the component where it&apos;s used.</>,
    docs: "guides/link-web-components-to-your-package",
    toFix: true,
  },
  "lazy-import": {
    label: ["lazy-loaded use wasn't counted", "lazy-loaded uses weren't counted"],
    fix: <>Have each <Code>import()</Code> pick a single export.</>,
    docs: "reference/diagnostics#lazy-import-unsupported",
    toFix: true,
  },
  "package-exports": {
    label: ["use from a package whose exports couldn't be followed", "uses from packages whose exports couldn't be followed"],
    fix: "Nothing to change in this repo.",
    docs: "reference/diagnostics#package-re-export-codes",
    toFix: false,
  },
  "not-matched": {
    label: ["use couldn't be matched to a component", "uses couldn't be matched to a component"],
    fix: <>Fix misspelled imports, and widen <Code>include</Code> if a file they need wasn&apos;t scanned.</>,
    docs: "reference/diagnostics#unresolved-reference",
    toFix: false,
  },
  "passed-in": {
    label: ["component passed in as a prop or argument wasn't counted", "components passed in as a prop or argument weren't counted"],
    fix: "Nothing to change.",
    docs: "reference/diagnostics#late-bound-render",
    toFix: false,
  },
};

const Dot = () => <span aria-hidden className="text-muted-foreground/60">·</span>;

/** What the shown scan couldn't see, closed to one line; nothing when it reported nothing. */
export function ScanFindings({ findings }: { findings: ScanFinding[] }) {
  if (findings.length === 0) return null;
  const toFix = findings.filter(finding => KINDS[finding.kind].toFix).length;
  return (
    <details className="group rounded-md border border-border bg-accent/40 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 [&::-webkit-details-marker]:hidden">
        <Info aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium text-foreground">This scan couldn&apos;t see everything</span>
          {toFix > 0 ? <> <span className="flex items-baseline gap-x-1.5 text-muted-foreground"><Dot /> {counted(toFix, "thing to fix", "things to fix")}</span></> : null}
        </span>
        <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {findings.map(finding => {
          const kind = KINDS[finding.kind];
          const labelId = `scan-finding-${finding.kind}`;
          return (
            <li key={finding.kind} className="space-y-1 px-3 py-2.5 sm:pl-[2.125rem]">
              <p id={labelId} className={cn(kind.toFix ? "text-foreground" : "text-muted-foreground")}>
                <span className="font-medium tabular-nums">{finding.count.toLocaleString()}</span>{" "}
                {finding.count === 1 ? kind.label[0] : kind.label[1]}
              </p>
              <p className="flex flex-wrap gap-x-1.5 text-muted-foreground">
                {finding.examples.map((example, index) => (
                  <span key={example.text} className="flex min-w-0 items-baseline gap-x-1.5">
                    {index > 0 ? <><Dot />{" "}</> : null}
                    <span className="break-all font-mono text-foreground/80">{example.text}</span>{" "}
                    <span className="tabular-nums">{example.count.toLocaleString()}</span>{" "}
                  </span>
                ))}
                {finding.more > 0 ? <span className="flex items-baseline gap-x-1.5 whitespace-nowrap"><Dot /> {finding.more.toLocaleString()} more</span> : null}
              </p>
              <p className="text-muted-foreground">
                {kind.fix}{" "}
                <a href={`${DOCS}/${kind.docs}`} aria-describedby={labelId} className="whitespace-nowrap rounded-sm text-foreground underline-offset-4 hover:underline">
                  Learn more
                </a>
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
