// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PersonListing } from "@/lib/people";

vi.mock("@/app/settings/people-actions", () => ({
  changeRole: vi.fn(async () => ({ ok: true })),
  removeFromPeople: vi.fn(async () => ({ ok: true })),
}));

import { changeRole, removeFromPeople } from "@/app/settings/people-actions";
import { PeopleTable } from "@/components/settings/people-table";

const person = (userId: string, email: string, extra: Partial<PersonListing> = {}): PersonListing => ({
  userId, name: null, email, lastSignedInAt: null, role: "viewer", roleSource: "people", canChangeRole: true, canRemove: true, ...extra,
});
const people = [
  person("ana", "ana@example.com", { name: "Ana Ruiz", role: "admin", canChangeRole: false, canRemove: false }),
  person("lee", "lee@example.com", { role: "admin", roleSource: "install", canChangeRole: false, canRemove: false }),
  person("mo", "mo@example.com", { role: "admin", roleSource: "group", canChangeRole: false }),
  person("sam", "sam@example.com"),
];
const rowOf = (email: string) => screen.getByRole("row", { name: new RegExp(email) });

beforeEach(() => vi.clearAllMocks());

describe("PeopleTable", () => {
  it("shows the role as text with no Remove on rows that can't be changed or removed, naming where a fixed Admin comes from, and gives a row that can be both a role picker and Remove", () => {
    render(<PeopleTable people={people} />);
    for (const [email, role] of [
      ["ana@example.com", "Admin"],
      ["lee@example.com", "Admin (set at install)"],
    ] as const) {
      const row = rowOf(email);
      expect(within(row).getByText(role)).toBeInTheDocument();
      expect(within(row).queryByRole("combobox")).toBeNull();
      expect(within(row).queryByRole("button", { name: "Remove" })).toBeNull();
    }
    const sam = rowOf("sam@example.com");
    expect(within(sam).getByRole("combobox", { name: "Role for sam@example.com" })).toHaveValue("viewer");
    expect(within(sam).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows a row that can only be removed as text with Remove", () => {
    render(<PeopleTable people={people} />);
    const mo = rowOf("mo@example.com");
    expect(within(mo).getByText("Admin (from SSO group)")).toBeInTheDocument();
    expect(within(mo).queryByRole("combobox")).toBeNull();
    expect(within(mo).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("changes the role to the one picked", () => {
    render(<PeopleTable people={people} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Role for sam@example.com" }), { target: { value: "editor" } });
    expect(changeRole).toHaveBeenCalledExactlyOnceWith("sam", "editor");
  });

  it("asks before removing someone, and removes them once confirmed", () => {
    render(<PeopleTable people={people} />);
    const sam = rowOf("sam@example.com");
    fireEvent.click(within(sam).getByRole("button", { name: "Remove" }));
    expect(within(sam).getByText("Remove sam@example.com?")).toBeInTheDocument();
    expect(removeFromPeople).not.toHaveBeenCalled();
    fireEvent.click(within(sam).getByRole("button", { name: "Remove" }));
    expect(removeFromPeople).toHaveBeenCalledExactlyOnceWith("sam");
  });
});
