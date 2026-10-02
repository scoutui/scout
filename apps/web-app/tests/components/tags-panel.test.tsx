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
  it("lists each tag's packages and how many scanned packages it matches", () => {
    render(<TagsPanel allTags={[vben]} packageNames={packageNames} />);
    const row = screen.getByRole("row", { name: /vben/ });
    expect(within(row).getByText("@vben/*")).toBeInTheDocument();
    expect(within(row).getByText("legacy-kit")).toBeInTheDocument();
    const matches = within(within(row).getByRole("cell", { name: "3 packages" })).getByText("3 packages");
    expect(matches).toHaveAttribute("title", "@vben/icons, @vben/layouts, legacy-kit");
  });

  it("puts each tag's swatch before its name, with no Colour column", () => {
    render(<TagsPanel allTags={[vben]} packageNames={packageNames} />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Name",
      "Packages",
      "Matches",
      "Edit",
    ]);
    const [nameCell] = within(screen.getByRole("row", { name: /vben/ })).getAllByRole("cell");
    const swatch = nameCell?.querySelector("[aria-hidden]");
    expect(swatch).not.toBeNull();
    const name = within(nameCell as HTMLElement).getByText("vben");
    expect(swatch?.compareDocumentPosition(name)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows four of six or more packages and toggles the rest", () => {
    const libs: Tag = { ...vben, value: "libs", rule: { glob: [], exact: ["p1", "p2", "p3", "p4", "p5", "p6"] } };
    render(<TagsPanel allTags={[libs]} packageNames={packageNames} />);
    const more = screen.getByRole("button", { name: "Show 2 more packages in libs", expanded: false });
    expect(more).toHaveTextContent("+2 more");
    expect(screen.getByText("p4")).toBeInTheDocument();
    expect(screen.queryByText("p5")).toBeNull();
    expect(screen.queryByText("p6")).toBeNull();

    more.focus();
    fireEvent.click(more);
    const fewer = screen.getByRole("button", { name: "Show fewer", expanded: true });
    expect(fewer).toHaveFocus();
    expect(screen.getByText("p5")).toBeInTheDocument();
    expect(screen.getByText("p6")).toBeInTheDocument();

    fireEvent.click(fewer);
    expect(screen.getByRole("button", { name: "Show 2 more packages in libs", expanded: false })).toHaveFocus();
    expect(screen.queryByText("p5")).toBeNull();
  });

  it("shows every package when there are five", () => {
    const libs: Tag = { ...vben, value: "libs", rule: { glob: ["p5*"], exact: ["p1", "p2", "p3", "p4"] } };
    render(<TagsPanel allTags={[libs]} packageNames={packageNames} />);
    for (const entry of ["p1", "p2", "p3", "p4", "p5*"]) expect(screen.getByText(entry)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more packages/ })).toBeNull();
  });

  it("says when a tag matches no scanned package", () => {
    render(<TagsPanel allTags={[{ ...vben, rule: { glob: [], exact: ["gone"] } }]} packageNames={packageNames} />);
    expect(screen.getByRole("cell", { name: "No scanned package" })).toBeInTheDocument();
  });

  it("says No data for matches while scan results are rebuilding", () => {
    render(<TagsPanel allTags={[vben]} packageNames={null} />);
    const cell = screen.getByRole("cell", { name: "No data" });
    expect(within(cell).getByText("No data")).not.toHaveAttribute("title");
    expect(screen.queryByRole("cell", { name: "No scanned package" })).toBeNull();
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

  it("previews no matches while scan results are rebuilding", () => {
    render(<TagsPanel allTags={[]} packageNames={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Packages" }), { target: { value: "@vben/*" } });
    expect(screen.queryByText(/^Matches /)).toBeNull();
  });

  it("names each colour choice in the tag form", () => {
    render(<TagsPanel allTags={[]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const radios = within(screen.getByRole("radiogroup", { name: "Colour" })).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["Teal", "Violet", "Blue", "Grey"]);
    for (const radio of radios) {
      expect(radio).toHaveAttribute("title", radio.getAttribute("aria-label"));
      expect(radio).toHaveTextContent(/^$/);
    }
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

  it("returns focus to the tag's Edit button when its form is cancelled", () => {
    render(<TagsPanel allTags={[vben]} packageNames={packageNames} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit vben" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit vben" })).toHaveFocus();
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
