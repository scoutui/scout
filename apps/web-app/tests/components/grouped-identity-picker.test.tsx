// @vitest-environment jsdom
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GovernanceRecord } from "@scoutui/web-shared";
import { GroupedIdentityPicker, type IdentityPick } from "@/components/governance/grouped-identity-picker";
import type { PickerTarget } from "@/lib/identity-search";

const sources: PickerTarget[] = [
  { packageName: "@example/old-ui", occurrences: 70 },
  { packageName: "@example/old-ui", exportName: "Button", occurrences: 60 },
  { packageName: "@example/old-ui", exportName: "Card", occurrences: 10 },
  { packageName: "@example/new-ui", occurrences: 8 },
  { packageName: "@example/new-ui", exportName: "Button", occurrences: 8 },
];
const recorded: GovernanceRecord = {
  id: "r1", grain: "component", targetPackage: "@example/old-ui", targetExport: "Button",
  disposition: { kind: "retired", reason: "replaced" }, createdAt: "t", updatedAt: "t",
};

function Field(props: { records?: GovernanceRecord[]; value?: IdentityPick | null; scope?: string | null; onSelect?: (p: IdentityPick) => void; onScopeChange?: (s: string | null) => void }) {
  const [scope, setScope] = useState(props.scope ?? null);
  return (
    <>
      <label id="source-label" htmlFor="source">Package or component</label>
      <GroupedIdentityPicker
        id="source" labelId="source-label" mode="source" sources={sources} records={props.records ?? []}
        value={props.value ?? null} onSelect={props.onSelect ?? (() => {})}
        scope={scope} onScopeChange={(s) => { setScope(s); props.onScopeChange?.(s); }}
        placeholder="Search packages and components"
      />
    </>
  );
}

const input = () => screen.getByRole("combobox", { name: "Package or component" });
const active = () => document.getElementById(input().getAttribute("aria-activedescendant") ?? "") as HTMLElement;

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe("GroupedIdentityPicker", () => {
  it("reaches an already-recorded option with the arrows, and Enter there picks nothing", () => {
    const onSelect = vi.fn();
    render(<Field records={[recorded]} onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: "button" } });
    expect(active().textContent).toContain("@example/new-ui");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(active()).toHaveAttribute("aria-disabled", "true");
    expect(active()).toHaveAccessibleName(/Button.*@example\/old-ui.*Already recorded/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "Package or component" })).toBeInTheDocument();
  });

  it("narrows to a package with Enter on its row, and Backspace on an empty search widens it again", () => {
    const onScopeChange = vi.fn();
    const onSelect = vi.fn();
    render(<Field onScopeChange={onScopeChange} onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: "old" } });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(active().textContent).toMatch(/^@example\/old-ui/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onScopeChange).toHaveBeenLastCalledWith("@example/old-ui");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /All of @example\/old-ui/ })).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onScopeChange).toHaveBeenLastCalledWith(null);
  });

  it("picks the first component on Enter, never the whole package", () => {
    const onSelect = vi.fn();
    render(<Field scope="@example/old-ui" onSelect={onSelect} />);
    fireEvent.click(input());
    const listbox = screen.getByRole("listbox", { name: "Package or component" });
    expect(input()).toHaveAttribute("aria-controls", listbox.id);
    expect(active()).toHaveAttribute("aria-selected", "true");
    expect(within(listbox).getAllByRole("option")[0]).toHaveAccessibleName(/All of @example\/old-ui/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({ packageName: "@example/old-ui", exportName: "Button" });
  });

  it("keeps the value when closed without a pick", () => {
    const onSelect = vi.fn();
    render(<Field value={{ packageName: "@example/old-ui", exportName: "Card" }} onSelect={onSelect} />);
    fireEvent.click(input());
    fireEvent.change(input(), { target: { value: "but" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Card · @example/old-ui");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
