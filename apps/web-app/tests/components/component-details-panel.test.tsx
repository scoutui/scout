// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ComponentRow } from "@scoutui/web-shared";
import { ComponentDetailsPanel } from "@/components/repos/component-details-panel";
import type { ComponentPanelFacts } from "@/lib/component-panel";

const row: ComponentRow = {
  componentId: "c1", kind: "react-component", scope: "external", packageName: "@example/ui",
  displayName: "Button", disambiguator: null, version: "1.0.0", occurrenceCount: 40, fileCount: 12, deprecated: false,
};
const facts: ComponentPanelFacts = { source: null, props: { kept: true, uses: 40, top: [], neverSet: null } };
const variant = { name: "variant", set: 30, values: [{ kind: "value" as const, label: "primary", count: 20 }, { kind: "dynamic" as const, label: "", count: 10 }] };

function panel(over: Partial<ComponentProps<typeof ComponentDetailsPanel>> = {}, given: Partial<ComponentPanelFacts> = {}) {
  return render(
    <ComponentDetailsPanel
      repoId="r1" row={row} linked usedIn={null} mark={undefined} showChange={false}
      facts={{ state: "ready", facts: { ...facts, ...given } }} otherRepos={0} source={null} mode="column" canEdit={false} onClose={() => {}}
      {...over}
    />,
  );
}
const counts = (occurrenceCount: number) => ({ occurrenceCount, fileCount: 1 });

describe("ComponentDetailsPanel", () => {
  it.each<[string, Partial<ComponentProps<typeof ComponentDetailsPanel>>, Partial<ComponentPanelFacts>, () => void]>([
    ["a deprecated component with a long replacement", {
      row: { ...row, deprecated: true, migration: { status: { status: "superseded", by: { packageName: "@some-enterprise-organisation/next-generation-design-system", exportName: "Button" } }, recordId: "r" } },
    }, {}, () => {
      expect(screen.getByText("Deprecated")).toBeInTheDocument();
      expect(screen.getByText("@some-enterprise-organisation/next-generation-design-system/Button")).toBeInTheDocument();
    }],
    ["a retired component with a three-sentence reason", {
      row: { ...row, deprecated: true, migration: { status: { status: "retired", reason: "Use Tag instead. Badge duplicated Tag. Migrate before Q3." }, recordId: null } },
    }, {}, () => expect(screen.getByText("Retired · Use Tag instead. Badge duplicated Tag. Migrate before Q3.")).toBeInTheDocument()],
    ["a component from outside the repo", {}, { props: { kept: true, uses: 40, top: [variant], neverSet: null } }, () => {
      expect(screen.queryByRole("link", { name: /source/ })).toBeNull();
      expect(screen.queryByText(/never set/)).toBeNull();
    }],
    ["a component defined in the repo", { source: { remote: { host: "github.com", href: "https://github.com/example/app" } as never, commit: "abc123" } }, { source: { filePath: "src/Button.tsx", line: 12 } }, () => {
      expect(screen.getByRole("link", { name: "View Button source" })).toHaveAttribute("href", "https://github.com/example/app/blob/abc123/src/Button.tsx#L12");
    }],
    ["a component new in this scan, on the sheet", { mode: "sheet", mark: { kind: "added" }, showChange: true, row: { ...row, usedIn: { "@example/web": counts(30), "@example/admin": counts(10) } } }, { props: { kept: true, uses: 40, top: [variant], neverSet: null } }, () => {
      expect(screen.getByText("New in this scan")).toBeInTheDocument();
      expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "40 uses")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Top props" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Top packages" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Next component" })).toBeNull();
    }],
    ["a component in a one-package scan", {}, {}, () => expect(screen.queryByText("Top packages")).toBeNull()],
    ["a component used in four packages", { row: { ...row, usedIn: { "@example/web": counts(30), "@example/admin": counts(8), "@example/docs": counts(1), "@example/lab": counts(1) } } }, {}, () => {
      expect(screen.getByRole("heading", { name: "Top packages · 3 of 4" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "@example/web" })).toHaveAttribute("href", "/repos/r1/components/c1?area=@example/web");
      expect(screen.queryByRole("link", { name: "@example/lab" })).toBeNull();
    }],
    ["a component with twelve declared props never set", {}, { props: { kept: true, uses: 40, top: [], neverSet: 12 } }, () => {
      expect(screen.getByText("12 props never set")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "12 props never set" })).toBeNull();
    }],
    ["an older scan, whose prop values aren't kept, with a note in place of the props", {}, { props: { kept: false } }, () => {
      expect(screen.queryByRole("heading", { name: "Top props" })).toBeNull();
      expect(screen.getByText("Top props are kept for the latest scan only.")).toBeInTheDocument();
    }],
    ["a component the latest scan doesn't have", { linked: false }, {}, () => {
      expect(screen.queryByRole("link", { name: /Open usage/ })).toBeNull();
      expect(screen.getByText("Not in the latest scan, so it has no usage page.")).toBeInTheDocument();
    }],
  ])("shows %s", (_title, over, given, check) => {
    panel(over, given);
    check();
  });

  it.each<[ComponentProps<typeof ComponentDetailsPanel>["mode"], boolean]>([["sheet", true], ["column", false]])(
    "in the %s, says the row's change and repeats its uses and files: %s",
    (mode, repeated) => {
      panel({ mode, mark: { kind: "changed", delta: -3 }, showChange: true });
      expect(screen.getByText("−3 since previous scan")).toBeInTheDocument();
      expect(screen.queryByText((_, el) => el?.tagName === "SPAN" && el.textContent === "40 uses") !== null).toBe(repeated);
    },
  );

  it("names the heading in plain text, not a link, breaking it only between words, and the package and path only after slashes", () => {
    panel({ row: { ...row, displayName: "HTMLDataTable", packageName: "@example/ui", disambiguator: "src/components/data-table.tsx" } });
    const breaks = (el: Element) => el.innerHTML.replaceAll("<wbr>", "|").replace(/<[^>]*>/g, "");
    expect(breaks(screen.getByRole("heading", { level: 2, name: "HTMLDataTable" }))).toBe("HTML|Data|Table");
    expect(screen.queryByRole("link", { name: "HTMLDataTable" })).toBeNull();
    expect(breaks(screen.getByText((_, el) => el?.textContent === "@example/ui"))).toBe("@example/|ui");
    expect(breaks(screen.getByText((_, el) => el?.textContent === "src/components/data-table.tsx"))).toBe("src/|components/|data-table.tsx");
  });

  it("links each prop value to usage filtered to it, reads {…} as an expression, and leaves the prop name plain", () => {
    panel({}, { props: { kept: true, uses: 40, top: [variant], neverSet: null } });
    expect(screen.getByRole("link", { name: "variant primary, 20 uses" })).toHaveAttribute("href", "/repos/r1/components/c1?sel=variant~value~primary");
    expect(screen.getByRole("link", { name: "variant expression, 10 uses" })).toHaveAttribute("href", "/repos/r1/components/c1?sel=variant~dynamic~");
    expect(screen.getByText("{…}")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "variant" })).toBeNull();
  });

  it("says where else the component is used only when other repos have it", () => {
    const { unmount } = panel({ otherRepos: 2 });
    expect(screen.getByRole("link", { name: "2 other repos" })).toHaveAttribute("href", "/components/c1");
    unmount();
    panel();
    expect(screen.queryByText(/Used in/)).toBeNull();
  });

  it("steps to the next component, and can't step before the first", () => {
    const onNext = vi.fn();
    panel({ onNext });
    expect(screen.getByRole("button", { name: "Previous component" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next component" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("holds the props' place while they load, and says when they couldn't", () => {
    const { unmount } = panel({ facts: { state: "loading", previous: null, slow: false } });
    expect(screen.queryByText("Top props")).toBeNull();
    expect(screen.getByRole("link", { name: /Open usage/ })).toBeInTheDocument();
    unmount();
    panel({ facts: { state: "error" } });
    expect(screen.getByText("Couldn't load some details.")).toBeInTheDocument();
  });
});
