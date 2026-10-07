// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ScanFinding } from "@scoutui/web-shared";
import { ScanFindings } from "@/components/repos/scan-findings";

const notImported: ScanFinding = { kind: "not-imported", count: 11, examples: [{ text: "VDropdown", count: 8 }, { text: "VMenu", count: 2 }, { text: "VTooltip", count: 1 }], more: 2 };
const element: ScanFinding = { kind: "undefined-element", count: 1, examples: [{ text: "<i18n-t>", count: 16 }], more: 0 };
const passedIn: ScanFinding = { kind: "passed-in", count: 7, examples: [{ text: "Icon", count: 7 }], more: 0 };

describe("ScanFindings", () => {
  it("shows nothing when the scan reported nothing", () => {
    const { container, rerender } = render(<ScanFindings findings={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ScanFindings findings={[passedIn]} />);
    expect(container).not.toBeEmptyDOMElement();
  });

  it.each([
    ["rows to fix and a row with nothing to change", [notImported, element, passedIn], "This scan couldn't see everything · 12 things to fix"],
    ["one thing to fix", [element], "This scan couldn't see everything · 1 thing to fix"],
    ["nothing to fix", [passedIn], "This scan couldn't see everything"],
  ])("closes to one line that adds up the rows to fix: %s", (_, findings, line) => {
    const { container } = render(<ScanFindings findings={findings} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector("summary")).toHaveTextContent(new RegExp(`^${line}$`));
  });

  it("lists each kind with its count, its most frequent examples, how many more, its fix and a link to the docs", () => {
    render(<ScanFindings findings={[notImported, element, passedIn]} />);
    const [first, second, third] = screen.getAllByRole("listitem");
    expect(first).toHaveTextContent(/^11 uses of components that aren't imported/);
    expect(first).toHaveTextContent("VDropdown 8 · VMenu 2 · VTooltip 1 · 2 more");
    expect(first).toHaveTextContent("Import each component where it's used, or list it in an auto-import file.");
    expect(within(first as HTMLElement).getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences");
    expect(second).toHaveTextContent(/^1 undefined element/);
    expect(second).toHaveTextContent("<i18n-t> 16");
    expect(third).toHaveTextContent(/^7 uses of components passed in as a prop or argument weren't counted/);
  });
});
