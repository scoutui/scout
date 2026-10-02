import { AlertTriangle } from "lucide-react";

/**
 * A deprecated component's marker in a table row or a render tree chip: the
 * warning glyph in `--status-warn` right after the name, with the word for
 * screen readers.
 */
export function DeprecatedMark() {
  return (
    <span className="inline-flex shrink-0 text-status-warn">
      <AlertTriangle aria-hidden className="size-3.5" />
      <span className="sr-only">deprecated</span>
    </span>
  );
}
