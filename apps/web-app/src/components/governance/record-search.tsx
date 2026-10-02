"use client";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * In-panel record filter. Filters on the client and isn't kept in the URL.
 */
export function RecordSearch({
  value,
  onChange,
  count,
}: {
  value: string;
  onChange: (value: string) => void;
  count: number;
}) {
  return (
    <div className="max-w-sm space-y-1">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search records…"
          aria-label="Search records by package, component or successor"
          className="pl-8"
        />
      </div>
      <p aria-live="polite" className="text-[0.6875rem] tabular-nums text-muted-foreground">
        {value.trim() && count > 0
          ? `${count.toLocaleString()} ${count === 1 ? "record" : "records"} match`
          : " "}
      </p>
    </div>
  );
}
