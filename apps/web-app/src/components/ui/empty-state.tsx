import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** The title's element: a heading where the state stands in for a page or section. */
  titleAs?: "p" | "h1" | "h2";
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  titleAs: Title = "p",
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "panel flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <Title className="font-sans text-sm font-medium text-foreground">{title}</Title>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
