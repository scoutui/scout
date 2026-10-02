// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Tag } from "@scoutui/web-shared";
import { TagsPanel } from "@/components/tags/tags-panel";
import { splitPatterns } from "@/components/tags/tag-manager";

vi.mock("@/app/packages/tag-actions", () => ({
  saveTag: vi.fn(async () => ({ ok: true })),
  deleteTag: vi.fn(async () => ({ ok: true })),
}));

const vben: Tag = {
  id: "t1",
  value: "vben",
  category: "library",
  color: "#7d8088",
  rule: { glob: ["@vben/*"], exact: ["legacy-kit"] },
};
const packageNames = ["@vben/icons", "@vben/layouts", "legacy-kit", "react"];

beforeEach(() => vi.clearAllMocks());

describe("TagsPanel", () => {
  it("lists each tag's colour by name, its packages, and how many scanned packages it matches", () => {
    render(<TagsPanel allTags={[vben]} packageNames={packageNames} />);
    const row = screen.getByRole("row", { name: /vben/ });
    expect(within(row).getByText("Grey")).toBeInTheDocument();
    expect(within(row).getByText("@vben/*")).toBeInTheDocument();
    expect(within(row).getByText("legacy-kit")).toBeInTheDocument();
    const matches = within(row).getByText("3 packages");
    expect(matches).toHaveAttribute("title", "@vben/icons, @vben/layouts, legacy-kit");
  });

  it("says when a tag matches no scanned package", () => {
    render(<TagsPanel allTags={[{ ...vben, rule: { glob: [], exact: ["gone"] } }]} packageNames={packageNames} />);
    expect(screen.getByText("No scanned package")).toBeInTheDocument();
  });

  it("previews what the Packages box matches while you type", () => {
    render(<TagsPanel allTags={[]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const box = screen.getByRole("textbox", { name: "Packages" });
    fireEvent.change(box, { target: { value: "@vben/*" } });
    expect(screen.getByText(/^Matches 2 packages:/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "nothing-*" } });
    expect(screen.getByText("Matches no scanned package")).toBeInTheDocument();
  });

  it("saves entries with a * as patterns and the rest as exact names", async () => {
    render(<TagsPanel allTags={[]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "kit" } });
    fireEvent.click(screen.getByRole("radio", { name: "Violet" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Packages" }), { target: { value: "@vben/*\nlegacy-kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const { saveTag } = await import("@/app/packages/tag-actions");
    await vi.waitFor(() =>
      expect(saveTag).toHaveBeenCalledWith(
        expect.objectContaining({ value: "kit", color: "#9b6bce", rule: { glob: ["@vben/*"], exact: ["legacy-kit"] } }),
      ),
    );
  });

  it("saves an edited tag's rule back unchanged when nothing was edited", async () => {
    render(<TagsPanel allTags={[vben]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit vben" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const { saveTag } = await import("@/app/packages/tag-actions");
    await vi.waitFor(() => expect(saveTag).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", rule: vben.rule })));
  });

  it("asks before deleting a tag and says what it affects", async () => {
    render(<TagsPanel allTags={[vben]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit vben" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete vben? Charts that use it lose that line.")).toBeInTheDocument();
    const { deleteTag } = await import("@/app/packages/tag-actions");
    expect(deleteTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteTag).toHaveBeenCalledWith("t1"));
  });

  it("won't save a tag without a name", async () => {
    render(<TagsPanel allTags={[]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    const { saveTag } = await import("@/app/packages/tag-actions");
    expect(saveTag).not.toHaveBeenCalled();
  });
});

describe("splitPatterns", () => {
  it.each([
    ["@a/*\nb", { glob: ["@a/*"], exact: ["b"] }],
    ["b, c\n\n b", { glob: [], exact: ["b", "c"] }],
    ["", { glob: [], exact: [] }],
  ])("splitPatterns(%j)", (raw, expected) => {
    expect(splitPatterns(raw)).toEqual(expected);
  });
});
