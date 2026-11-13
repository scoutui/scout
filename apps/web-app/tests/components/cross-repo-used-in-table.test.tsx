// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CrossRepoUsedInTable } from "@/components/components-tab/cross-repo-used-in-table";

describe("CrossRepoUsedInTable", () => {
  it("sorts by Version in SemVer order, unversioned last", () => {
    const usage = (repoId: string, version: string | null) => ({ repoId, version, occurrenceCount: 1, deprecated: false, committedAt: "2026-05-15T00:00:00Z" });
    render(<CrossRepoUsedInTable componentId="c" usages={[usage("a", "1.14.0"), usage("n", null), usage("b", "1.5.0")]} />);
    fireEvent.click(screen.getByRole("button", { name: /^version/i }));
    expect(screen.getAllByRole("row").slice(1).map(r => r.querySelector("a")?.title)).toEqual(["b", "a", "n"]);
  });
});
