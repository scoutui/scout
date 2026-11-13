// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { RepoDelta } from "@scoutui/web-shared";
import { ScanDiffLine } from "@/components/repos/scan-diff-line";

function text(el: Element, drop: string): string {
  const copy = el.cloneNode(true) as Element;
  for (const node of copy.querySelectorAll(drop)) node.remove();
  return copy.textContent ?? "";
}

const delta = (o: Partial<RepoDelta>): RepoDelta => ({ added: 0, removed: 0, changed: 0, deprecated: 0, ...o });

describe("ScanDiffLine", () => {
  it.each([
    ["added, removed and changed", delta({ added: 3, removed: 8, changed: 18 }), "+3 added · −8 removed · 18 changed since previous scan", "+3 added −8 removed 18 changed since previous scan"],
    ["removed only", delta({ removed: 2 }), "−2 removed since previous scan", "−2 removed since previous scan"],
    ["changed only", delta({ changed: 1200 }), "1,200 changed since previous scan", "1,200 changed since previous scan"],
    ["only the deprecated count moved", delta({ deprecated: -2 }), "No change since previous scan", "No change since previous scan"],
    ["a first scan", null, "First scan, nothing to compare", "First scan, nothing to compare"],
  ])("%s", (_, d, seen, heard) => {
    const { container } = render(<ScanDiffLine delta={d} />);
    const line = container.firstElementChild as Element;
    expect(text(line, ".sr-only")).toBe(seen);
    expect(text(line, "[aria-hidden]")).toBe(heard);
  });
});
