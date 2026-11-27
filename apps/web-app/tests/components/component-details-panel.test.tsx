// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { deriveGovernanceTracking, type ComponentRow, type DigestScan, type GovernanceRecord } from "@scoutui/web-shared";
import { component, packageExport } from "../../../../packages/web-shared/tests/helpers/builders.ts";
import { ComponentDetailsPanel } from "@/components/repos/component-details-panel";
import type { ComponentPanelFacts } from "@/lib/component-panel";

const row: ComponentRow = {
  componentId: "c1", kind: "react-component", scope: "external", packageName: "@example/ui",
  displayName: "Button", disambiguator: null, version: "1.0.0", occurrenceCount: 40, fileCount: 12, deprecated: false,
};
const facts: ComponentPanelFacts = { source: null, props: { kept: true, uses: 40, top: [], declared: null }, history: [] };
const variant = { name: "variant", set: 30, values: [{ kind: "value" as const, label: "primary", count: 20 }, { kind: "dynamic" as const, label: "", count: 10 }] };

function panel(over: Partial<ComponentProps<typeof ComponentDetailsPanel>> = {}, given: Partial<ComponentPanelFacts> = {}) {
  return render(
    <ComponentDetailsPanel
      repoId="r1" row={row} linked usedIn={null} mark={undefined} showChange={false}
      facts={{ state: "ready", facts: { ...facts, ...given } }} previousUsesStory={false} entry={null} olderScanAt={null} otherRepos={0} source={null} mode="column" onClose={() => {}}
      {...over}
    />,
  );
}
/** `n` declared prop names, `prop01` on, in name order. */
const names = (n: number) => Array.from({ length: n }, (_, i) => `prop${String(i + 1).padStart(2, "0")}`);
const counts = (occurrenceCount: number) => ({ occurrenceCount, fileCount: 1 });

const used = (packageName: string, exportName: string, occurrenceCount: number) =>
  component(packageExport(packageName, exportName), { stats: { occurrenceCount, fileCount: 1 }, usage: "direct" });
// 16 weekly scans to 13 Nov 2026: Button falls by 2 a week and its replacement, from the fifth scan, rises by 3.
const scans: DigestScan[] = Array.from({ length: 16 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 10, 13) - (15 - i) * 7 * 86_400_000).toISOString();
  return { meta: { scanId: `s${i}`, committedAt: t, arrivedAt: t, repo: { id: "r1" } }, components: [
    used("@acme/old", "Button", 400 - 2 * i), used("@acme/old", "Card", 50), ...(i >= 4 ? [used("@acme/new", "Button", 3 * i)] : []),
  ] };
});
const record = (id: string, over: Partial<GovernanceRecord>): GovernanceRecord => ({
  id, grain: "component", targetPackage: "@acme/old", targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});
const tracking = deriveGovernanceTracking(
  [record("g-button", {}), record("g-old", { grain: "package", targetExport: null, disposition: { kind: "retired", reason: "Use @acme/new" } })],
  scans, { kind: "repo", repoId: "r1" }, "2026-11-14T00:00:00.000Z",
);
const entry = (recordId: string) => tracking.find((e) => e.recordIds.includes(recordId)) ?? null;
const paragraph = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);
/** The story's chart draws no line, only one dot at its end on the chart's frame, with `day` under it. */
function expectOneDotAtTheEnd(name: string, day: string) {
  const chart = screen.getByRole("img");
  expect(chart).toHaveAccessibleName(name);
  expect(chart.querySelector("polyline")).toBeNull();
  expect([...chart.querySelectorAll("circle")].map((dot) => dot.getAttribute("cx"))).toEqual(["392"]);
  expect(chart.getAttribute("viewBox")).toBe("0 0 400 56");
  expect(screen.getByText(day)).toBeInTheDocument();
}

describe("ComponentDetailsPanel", () => {
  it.each<[string, Partial<ComponentProps<typeof ComponentDetailsPanel>>, Partial<ComponentPanelFacts>, () => void]>([
    ["a deprecated component with a long replacement", {
      row: { ...row, deprecated: true, migration: { status: { status: "superseded", by: { packageName: "@some-enterprise-organisation/next-generation-design-system", exportName: "Button" } }, recordId: "r" } },
    }, {}, () => {
      expect(screen.getByText("Deprecated")).toBeInTheDocument();
      const replacement = screen.getByTitle("@some-enterprise-organisation/next-generation-design-system/Button");
      expect(replacement.closest("p")).toHaveClass("text-sm");
      expect(replacement.closest("p")?.firstChild).toHaveTextContent(/^Replaced by$/);
      expect(replacement).toHaveClass("font-mono", "text-foreground");
      expect(document.querySelector("a[href^='/governance']")).toBeNull();
    }],
    ["a retired component with a three-sentence reason", {
      row: { ...row, deprecated: true, migration: { status: { status: "retired", reason: "Use Tag instead. Badge duplicated Tag. Migrate before Q3." }, recordId: null } },
    }, {}, () => expect(screen.getByText("Retired: Use Tag instead. Badge duplicated Tag. Migrate before Q3.")).toBeInTheDocument()],
    ["a component from outside the repo", {}, { props: { kept: true, uses: 40, top: [variant], declared: null } }, () => {
      expect(screen.queryByRole("link", { name: /source/ })).toBeNull();
      expect(screen.queryByText(/never set/)).toBeNull();
    }],
    ["a component defined in the repo", { source: { remote: { host: "github.com", href: "https://github.com/example/app" } as never, commit: "abc123" } }, { source: { filePath: "src/Button.tsx", line: 12 } }, () => {
      expect(screen.getByRole("link", { name: "View Button source" })).toHaveAttribute("href", "https://github.com/example/app/blob/abc123/src/Button.tsx#L12");
    }],
    ["a component new in this scan, on the sheet", { mode: "sheet", mark: { kind: "added" }, showChange: true, row: { ...row, usedIn: { "@example/web": counts(30), "@example/admin": counts(10) } } }, { props: { kept: true, uses: 40, top: [variant], declared: null }, history: [{ t: "2026-11-13T00:00:00.000Z", value: 40 }] }, () => {
      expect(screen.getByRole("heading", { name: "Uses · 3 months" })).toBeInTheDocument();
      expect(paragraph("40 uses in this scan")).toBeInTheDocument();
      expectOneDotAtTheEnd("Uses of Button: 40 on 13 Nov.", "13 Nov");
      expect(paragraph("New in this scan, so its history starts here.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Fill in past scans" })).toBeNull();
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
    ["a component with twelve unused props, six named and the rest counted", {}, { props: { kept: true, uses: 40, top: [variant], declared: { declaredCount: 14, unused: names(12), possiblyUnused: [] } } }, () => {
      const section = screen.getByRole("region", { name: "Declared props · 14" });
      expect(within(section).getAllByRole("listitem").map(li => li.textContent)).toEqual(["prop01", "prop02", "prop03", "prop04", "prop05", "prop06", "and 6 more"]);
      expect(within(section).queryByRole("list", { name: "Possibly unused" })).toBeNull();
      expect(within(section).queryByRole("link")).toBeNull();
      expect(screen.getByRole("heading", { name: "Top props" })).toBeInTheDocument();
    }],
    ["a component with seven unused props, all named rather than hide one", {}, { props: { kept: true, uses: 40, top: [], declared: { declaredCount: 7, unused: names(7), possiblyUnused: [] } } }, () => {
      expect(within(screen.getByRole("list", { name: "Unused" })).getAllByRole("listitem")).toHaveLength(7);
      expect(screen.queryByRole("heading", { name: "Top props" })).toBeNull();
    }],
    ["a component with unused and possibly unused props, in a row each", {}, { props: { kept: true, uses: 40, top: [variant], declared: { declaredCount: 12, unused: ["iconOnly", "loading"], possiblyUnused: ["label", "width"] } } }, () => {
      expect(within(screen.getByRole("list", { name: "Unused" })).getAllByRole("listitem").map(li => li.textContent)).toEqual(["iconOnly", "loading"]);
      expect(within(screen.getByRole("list", { name: "Possibly unused" })).getAllByRole("listitem").map(li => li.textContent)).toEqual(["label", "width"]);
      expect(screen.queryByText(/no use passes/)).toBeNull();
    }],
    ["a component with only possibly unused props, without an empty Unused row", {}, { props: { kept: true, uses: 40, top: [], declared: { declaredCount: 3, unused: [], possiblyUnused: ["label"] } } }, () => {
      expect(screen.getByRole("list", { name: "Possibly unused" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Unused" })).toBeNull();
    }],
    ["a component with no uses, saying so in place of verdicts", {}, { props: { kept: true, uses: 0, top: [], declared: { declaredCount: 4, unused: [], possiblyUnused: [] } } }, () => {
      expect(within(screen.getByRole("region", { name: "Declared props · 4" })).getByText("No uses")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Unused" })).toBeNull();
    }],
    ["a component whose declared props are all passed or defaulted", {}, { props: { kept: true, uses: 40, top: [variant], declared: { declaredCount: 3, unused: [], possiblyUnused: [] } } }, () => {
      expect(screen.queryByRole("heading", { name: /Declared props/ })).toBeNull();
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
    "in the %s, says the row's change after its uses story's summary and repeats its uses and files: %s",
    (mode, repeated) => {
      panel({ mode, mark: { kind: "changed", delta: -3 }, showChange: true }, { history: [{ t: "2026-10-30T00:00:00.000Z", value: 43 }, { t: "2026-11-13T00:00:00.000Z", value: 40 }] });
      expect(paragraph("43 to 40 uses in 3 months · −3 since previous scan")).toBeInTheDocument();
      expect(screen.queryByText((_, el) => el?.tagName === "SPAN" && el.textContent === "40 uses") !== null).toBe(repeated);
    },
  );

  it("names the heading in plain text, not a link, breaking it only between words, and the package and path only after slashes", () => {
    panel({ row: { ...row, displayName: "HTMLDataTable", packageName: "@example/ui", disambiguator: "src/components/data-table.tsx" } });
    const breaks = (el: Node): string =>
      [...el.childNodes].map((n) => (n.nodeName === "WBR" ? "|" : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? "") : breaks(n))).join("");
    expect(breaks(screen.getByRole("heading", { level: 2, name: "HTMLDataTable" }))).toBe("HTML|Data|Table");
    expect(screen.queryByRole("link", { name: "HTMLDataTable" })).toBeNull();
    expect(breaks(screen.getByText((_, el) => el?.textContent === "@example/ui"))).toBe("@example/|ui");
    expect(breaks(screen.getByText((_, el) => el?.textContent === "src/components/data-table.tsx"))).toBe("src/|components/|data-table.tsx");
  });

  it("lists Top props without a uses column, the bar's count only in the row's name", () => {
    panel({}, { props: { kept: true, uses: 40, top: [variant], declared: null } });
    const section = screen.getByRole("region", { name: "Top props" });
    expect(within(section).getByRole("listitem", { name: "variant, set on 30 of 40 uses" })).toBeInTheDocument();
    expect(within(section).queryByText("30")).toBeNull();
    expect(within(section).queryByText("uses")).toBeNull();
  });

  it("marks a default as the default and doesn't link it, since usage doesn't list the uses that leave the prop out yet", () => {
    const size = { name: "size", set: 12, values: [{ kind: "value" as const, label: "md", count: 28, isDefault: true as const }, { kind: "value" as const, label: "sm", count: 7 }] };
    const icon = { name: "icon", set: 2, values: [{ kind: "default" as const, label: "defaultIcon", count: 6 }] };
    panel({}, { props: { kept: true, uses: 40, top: [size, icon], declared: null } });
    expect(screen.getByLabelText("size md, the default, 28 uses").tagName).toBe("SPAN");
    expect(screen.getByLabelText("icon defaultIcon, the default, 6 uses")).toHaveTextContent("{defaultIcon}default6");
    expect(screen.getByRole("link", { name: "size sm, 7 uses" })).toHaveAttribute("href", "/repos/r1/components/c1?sel=size~value~sm");
  });

  it("links each prop value to usage filtered to it, reads {…} as an expression, and leaves the prop name plain", () => {
    panel({}, { props: { kept: true, uses: 40, top: [variant], declared: null } });
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

  it("tells a replaced component's migration over three months, as its chart reads it, opens that chart, and says the row's change on its own line", () => {
    panel({ entry: entry("g-button"), mark: { kind: "changed", delta: -3 }, showChange: true });
    expect(screen.getByText("−3 since previous scan")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Migration · 3 months" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open chart" })).toBeInTheDocument();
    expect(paragraph("10.8% migrated · 370 left · 10 fewer in the last 30 days")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Button@acme/old370", "Button@acme/new45"]);
    expect(screen.getByRole("img")).toHaveAccessibleName("Button · @acme/old: 398 on 13 Aug, 370 on 13 Nov. Button · @acme/new: 0 on 13 Aug, 45 on 13 Nov.");
    expect(screen.queryByRole("button", { name: "How this is counted" })).toBeNull();
  });

  it("names a record that covers a whole package behind an info button, which a press opens, a second press keeps open and Esc closes", async () => {
    panel({ row: { ...row, displayName: "Card" }, entry: entry("g-old") });
    expect(screen.getByRole("heading", { name: "Retirement · 3 months" })).toBeInTheDocument();
    expect(paragraph("420 left · 10 fewer in the last 30 days")).toBeInTheDocument();
    const info = screen.getByRole("button", { name: "How this is counted" });
    expect(screen.queryByText("Counts the whole", { exact: false })).toBeNull();
    fireEvent.click(info);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Counts the whole @acme/old package.");
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(info, { key: "Escape" });
    await act(async () => {});
    expect(info).toHaveAttribute("aria-expanded", "false");
  });

  it("ends a migration at an older scan, with that scan's counts and without the latest scan's summary", () => {
    panel({ entry: entry("g-button"), olderScanAt: scans[11]?.meta.committedAt ?? null });
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Button@acme/old378", "Button@acme/new33"]);
    expect(screen.queryByText(/migrated/)).toBeNull();
  });

  it("tells an ungoverned component's uses in this repo, with no chart to open, and no change since the previous scan anywhere", () => {
    panel({ showChange: true }, { history: [["2026-07-01", 30], ["2026-08-01", 32], ["2026-09-01", 35], ["2026-11-13", 40]].map(([d, value]) => ({ t: `${d}T00:00:00.000Z`, value: Number(value) })) });
    expect(screen.getByRole("heading", { name: "Uses · 3 months" })).toBeInTheDocument();
    expect(paragraph("32 to 40 uses in 3 months")).toBeInTheDocument();
    expect(screen.queryByText(/since previous scan/)).toBeNull();
    expect(screen.getByRole("img")).toHaveAccessibleName("Uses of Button: 32 on 13 Aug, 40 on 13 Nov.");
    expect(screen.queryByRole("link", { name: "Open chart" })).toBeNull();
    expect(screen.queryByRole("button", { name: "How this is counted" })).toBeNull();
  });

  it("starts a repo's first scan's story at its one point, saying one use, with a link to fill in past scans", () => {
    panel({ row: { ...row, occurrenceCount: 1 } }, { history: [{ t: "2026-11-13T00:00:00.000Z", value: 1 }] });
    expect(screen.getByRole("heading", { name: "Uses · 3 months" })).toBeInTheDocument();
    expect(paragraph("1 use in this scan")).toBeInTheDocument();
    expectOneDotAtTheEnd("Uses of Button: 1 on 13 Nov.", "13 Nov");
    expect(paragraph("History starts with the next scan. Fill in past scans")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fill in past scans" })).toHaveAttribute("href", "https://scoutui.dev/docs/guides/fill-in-a-repos-history");
  });

  it("says the story counts the whole repo while a Used in package is picked, when its info button gets keyboard focus", async () => {
    panel({ usedIn: "@example/web" }, { history: [{ t: "2026-10-01T00:00:00.000Z", value: 3 }, { t: "2026-11-01T00:00:00.000Z", value: 4 }] });
    act(() => screen.getByRole("button", { name: "How this is counted" }).focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Counts the whole repo, not just @example/web.");
  });

  it("fades the last one-point story without its note while the next component's facts load", () => {
    panel({ facts: { state: "loading", previous: { state: "ready", facts: { ...facts, history: [{ t: "2026-11-13T00:00:00.000Z", value: 9 }] } }, previousId: "c0", slow: false }, previousUsesStory: true });
    expect(paragraph("9 uses in this scan").closest('[aria-busy="true"]')).toHaveClass("opacity-60");
    expect(screen.queryByText(/History starts/)).toBeNull();
  });

  it("holds the props' place while they load, and says when they couldn't", () => {
    const { unmount } = panel({ facts: { state: "loading", previous: null, previousId: null, slow: false } });
    expect(screen.queryByText("Top props")).toBeNull();
    expect(screen.getByRole("link", { name: /Open usage/ })).toBeInTheDocument();
    unmount();
    panel({ facts: { state: "error" } });
    expect(screen.getByText("Couldn't load some details.")).toBeInTheDocument();
  });
});
