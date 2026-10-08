import { Fragment } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CompositionGraphNode } from "@scoutui/web-shared";
import { DeprecatedMark } from "@/components/deprecated-mark";
import { buttonVariants } from "@/components/ui/button";
import { ORIGIN_LABEL } from "@/lib/component-facets";
import { cn } from "@/lib/utils";
import { nameBreaks } from "./both-ends";
import { ScopeGlyph } from "./scope-glyph";

export const componentHref = (repoId: string, id: string) =>
  `/repos/${encodeURIComponent(repoId)}/components/${encodeURIComponent(id)}?tab=composition`;

/** Text that may wrap at the points `nameBreaks` finds, and anywhere when a piece is still too long. */
function Wrapping({ text }: { text: string }) {
  return nameBreaks(text).map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed string
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

/**
 * A component as a row or box shows it: the origin mark, the whole name, the
 * deprecated mark and, when another component shares the name, the folder
 * that tells them apart. Screen readers hear the origin after the name.
 */
export function ComponentName({
  node,
  fragment,
  strong = false,
}: {
  node: CompositionGraphNode;
  fragment: string | null;
  strong?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <ScopeGlyph scope={node.scope} className="mt-[5px]" />
      <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
        <span className={cn(strong && "font-semibold")}>
          <Wrapping text={node.displayName} />
        </span>
        {node.deprecated ? (
          <span className="ml-1 inline-flex align-[-2px]">
            <span className="sr-only">, </span>
            <DeprecatedMark />
          </span>
        ) : null}
        {fragment ? (
          <span className="text-muted-foreground">
            <span aria-hidden>{" · "}</span>
            <span className="sr-only">, </span>
            <Wrapping text={fragment} />
          </span>
        ) : null}
        <span className="sr-only">{`, ${ORIGIN_LABEL[node.scope]}`}</span>
      </span>
    </span>
  );
}

/** A link to a component's own page, drawn as an icon button. */
export function OpenLink({
  repoId,
  node,
  tabIndex,
  cell,
}: {
  repoId: string;
  node: CompositionGraphNode;
  tabIndex?: number;
  /** Its place in a row of a keyboard grid. */
  cell?: number;
}) {
  const label = `Open ${node.displayName}`;
  return (
    <Link
      href={componentHref(repoId, node.id)}
      prefetch={false}
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      data-cell={cell}
      className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }), "text-muted-foreground hover:text-foreground")}
    >
      <ArrowUpRight aria-hidden />
    </Link>
  );
}
