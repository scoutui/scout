// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Component, PropValueState } from "@scoutui/scan-format";
import { PostgresDriver } from "@scoutui/web-shared";
import { artifact, component, packageExport, repoDeclaration, resolvedAt } from "../../../../packages/web-shared/tests/helpers/builders.ts";
import { publishScan } from "../../src/lib/scan-projection.ts";
import { openReadModelDatabase } from "../helpers/read-model-db.ts";

const { DATABASE_URL: databaseUrl } = process.env;
let pool: Pool;
let driver: PostgresDriver;
vi.mock("@/lib/storage", () => ({ getStorage: () => driver }));
vi.mock("@/db/client", () => ({ getPool: () => pool }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "reader" } }) }));
vi.mock("@/lib/identity", () => ({
  identify: async () => ({ kind: "person", userId: "reader", email: "ana@example.com", name: null, role: "editor", roleSource: "people" }),
}));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>("next/navigation")),
  ...(await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
  usePathname: () => window.location.pathname,
}));

const written = (value: string): PropValueState => ({ tier: "written", value });
const declaredOnly = () => ({ values: [], dynamic: 0, omitted: 0 });
const button = component(packageExport("@example/ui", "Button"), {
  props: { size: declaredOnly(), onClick: declaredOnly(), className: declaredOnly(), "data-testid": declaredOnly(), variant: declaredOnly() },
  events: { onClick: { boundCount: 2 } },
});
const tag = component(packageExport("@example/ui", "Tag"));
const rendersButton = (count: number): Partial<Component> =>
  ({ composition: { rendersByCount: { [button.id]: count }, renderedByCount: {}, isRootCount: 0, isLeafCount: 0 } });
const payForm = component(repoDeclaration("shop", "src/checkout/Pay.tsx", "PayForm"), rendersButton(2));
const payDialog = component(repoDeclaration("shop", "src/checkout/Pay.tsx", "PayDialog"), rendersButton(1));
const panel = component(repoDeclaration("shop", "src/settings/Panel.tsx", "Panel"), rendersButton(2));
function at(file: string, line: number, column: number, owner: Component | null, props: Record<string, PropValueState>) {
  return resolvedAt(button, file, line, { occurrenceId: `${file}:${line}:${owner?.id ?? "-"}`, column, props, ...(owner ? { ownerComponentId: owner.id } : {}) });
}
const buttonCalls = [
  at("src/checkout/Pay.tsx", 6, 3, payForm, { size: written("large"), onClick: { tier: "dynamic" } }),
  at("src/checkout/Pay.tsx", 6, 3, payDialog, { size: written("large"), onClick: { tier: "dynamic" } }),
  at("src/checkout/Pay.tsx", 12, 3, payForm, { size: written("small"), className: written("wide"), "data-testid": written("pay") }),
  at("src/settings/Panel.tsx", 5, 3, panel, { size: written("large"), variant: { tier: "reference", ref: "tone" } }),
  at("src/settings/Panel.tsx", 9, 3, panel, { size: written("large") }),
  at("src/settings/config.tsx", 2, 1, null, { size: written("small") }),
  at("src/home/Hero.tsx", 3, 3, null, { variant: written("ghost") }),
];
const tagCalls = Array.from({ length: 250 }, (_, n) => resolvedAt(tag, `src/tags/t${n}/Tag${n}.tsx`, 1));
const card = component(packageExport("@example/ui", "Card"));
const cardCalls = Array.from({ length: 26 }, (_, n) => resolvedAt(card, `src/cards/${n % 2 ? "odd" : "even"}/Card${n}.tsx`, 1));
const unused = component(repoDeclaration("shop", "src/Unused.tsx", "Unused"), {
  definition: { line: 3, column: 1 },
  declared: { props: { size: { type: "'sm' | 'lg'", default: "sm" } }, hasRest: false },
});
const badge = component(packageExport("@example/ui", "Badge"));
const badgeCalls = [resolvedAt(badge, "src/home/Hero.tsx", 4), resolvedAt(badge, "src/home/Hero.tsx", 8), resolvedAt(badge, "src/settings/Panel.tsx", 2)];
const oldButton = component(packageExport("@example/ui", "OldButton"));
const oldCalls = Array.from({ length: 6 }, (_, n) => resolvedAt(oldButton, `src/legacy/Old${n}.tsx`, 1));
const link = component(packageExport("@example/ui", "Link"));
const linkCalls = [
  ...Array.from({ length: 4 }, (_, n) => resolvedAt(link, `apps/web/src/Page${n}.tsx`, 1, { usedIn: "@example/web" })),
  ...Array.from({ length: 2 }, (_, n) => resolvedAt(link, `apps/admin/src/Page${n}.tsx`, 1, { usedIn: "@example/admin" })),
];
const chip = component(packageExport("@example/ui", "Chip"));
const chipCalls = [
  ...Array.from({ length: 2 }, (_, n) => resolvedAt(chip, `apps/web/src/home/Hero${n}.tsx`, 1, { usedIn: "@example/web" })),
  resolvedAt(chip, "apps/web/src/cart/Cart.tsx", 1, { usedIn: "@example/web" }),
];
/** Every component the page tests open. */
const components: Component[] = [button, tag, card, payForm, payDialog, panel, unused, badge, oldButton, link, chip];
const occurrences = [...buttonCalls, ...tagCalls, ...cardCalls, ...badgeCalls, ...oldCalls, ...linkCalls, ...chipCalls];

async function show(componentId: string, search = "") {
  window.history.replaceState(null, "", `/repos/shop/components/${encodeURIComponent(componentId)}${search}`);
  const { default: page } = await import("@/app/repos/[repoId]/components/[componentId]/page");
  return render(await page({ params: Promise.resolve({ repoId: "shop", componentId: encodeURIComponent(componentId) }) }));
}
const query = () => new URLSearchParams(window.location.search);
const fileButtons = () => screen.getAllByRole("button", { name: /^Uses in / }).map(button => button.getAttribute("aria-label"));

describe.skipIf(!databaseUrl)("component page Usage tab", { timeout: 60_000 }, () => {
  let close: () => Promise<void>;
  beforeAll(async () => {
    // jsdom has no scrolling; the "Rendered by" link scrolls to the top, and F scrolls the filters into view.
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Element.prototype.scrollIntoView = () => {};
    const database = openReadModelDatabase();
    pool = await database.pool;
    close = database.close;
    driver = new PostgresDriver(pool);
    const scan = artifact({ repoId: "shop", components, occurrences });
    scan.meta.repo.gitRemote = "https://github.com/example/shop";
    await publishScan(pool, scan, { uploadedByUserId: null });
    await pool.query(`INSERT INTO governance (id, grain, target_package, target_export, disposition) VALUES ('old-button', 'component', '@example/ui', 'OldButton', '{"kind":"superseded","by":{"packageName":"@example/ui","exportName":"Button"}}')`);
  });
  afterAll(async () => close?.());

  it("has two tabs, Usage with its call count and Composition", async () => {
    await show(button.id);
    expect(screen.getByRole("tab", { name: /Usage/ })).toHaveTextContent("7");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /Composition/ })).toBeInTheDocument();
  });

  it.each(["events", "props"])("opens Usage for an old ?tab=%s link", async (tab) => {
    await show(button.id, `?tab=${tab}`);
    expect(screen.getByRole("tab", { name: /Usage/ })).toHaveAttribute("aria-selected", "true");
  });

  it("shows one line per call site, naming every component that renders it", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/checkout/Pay.tsx" }));
    expect(screen.getAllByText(":6")).toHaveLength(1);
    const renderers = (line: string) => within(screen.getByText(line).closest("tr") as HTMLElement).getAllByRole("link", { name: /^Show .+ in Composition$/ }).map(link => link.textContent);
    expect([renderers(":6"), renderers(":12")]).toEqual([["PayForm", "PayDialog"], ["PayForm"]]);
  });

  it("names the renderer once for a file one component renders", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/settings/Panel.tsx" }));
    expect(screen.getAllByRole("link", { name: "Show Panel in Composition" })).toHaveLength(1);
  });

  it("shows no renderer for a call outside any component", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/settings/config.tsx" }));
    expect(screen.getByText(":2")).toBeInTheDocument();
    expect(screen.queryByText(/Rendered by/)).toBeNull();
  });

  it("opens Composition with the renderer pinned, as a new history entry", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/checkout/Pay.tsx" }));
    const before = window.history.length;
    fireEvent.click(screen.getAllByRole("link", { name: "Show PayDialog in Composition" })[0] as HTMLElement);
    expect([query().get("tab"), query().get("pin"), window.history.length]).toEqual(["composition", `up:${payDialog.id}`, before + 1]);
    expect(await screen.findAllByRole("button", { name: /^PayDialog\b/, pressed: true })).not.toHaveLength(0);
  });

  it("reopens the rows, props and filter panel the reader left open on Back from Composition, and keeps rows opened later through an empty list", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Where it’s used and prop values" }));
    fireEvent.click(screen.getByRole("button", { name: /^size, set on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/checkout/Pay.tsx" }));
    fireEvent.click(screen.getAllByRole("link", { name: "Show PayDialog in Composition" })[0] as HTMLElement);
    await screen.findAllByRole("button", { name: /^PayDialog\b/, pressed: true });
    await act(() => new Promise(resolve => {
      window.addEventListener("popstate", resolve, { once: true });
      window.history.back();
    }));
    const expanded = (name: string | RegExp) => screen.getByRole("button", { name }).getAttribute("aria-expanded");
    expect([expanded("Where it’s used and prop values"), expanded(/^size, set on/), expanded("Uses in src/checkout/Pay.tsx"), expanded("Uses in src/settings/Panel.tsx")]).toEqual(["true", "true", "true", "false"]);
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/settings/Panel.tsx" }));
    const search = screen.getByRole("textbox", { name: "Search files and props" });
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("button", { name: /^Uses in / })).toHaveLength(0);
    fireEvent.change(search, { target: { value: "" } });
    expect([expanded("Uses in src/checkout/Pay.tsx"), expanded("Uses in src/settings/Panel.tsx")]).toEqual(["true", "true"]);
  });

  it("writes each file's most used values as JSX under its name", async () => {
    await show(button.id);
    const jsx = (path: string) => within(screen.getByRole("button", { name: `Uses in ${path}` }).closest("tr") as HTMLElement).queryByText(/^(size|variant)=/)?.textContent;
    expect([jsx("src/checkout/Pay.tsx"), jsx("src/home/Hero.tsx")]).toEqual(['size="large"', 'variant="ghost"']);
  });

  it("lists every file of a component used in 250 files", async () => {
    await show(tag.id);
    expect(fileButtons()).toHaveLength(250);
  });

  it("reproduces a filtered view from its link", async () => {
    await show(button.id, "?sel=size~value~large");
    expect(document.body).toHaveTextContent("4 of 7 uses");
    expect(screen.getByRole("button", { name: "Remove the filter size = large" })).toBeInTheDocument();
    expect(fileButtons()).toEqual(["Uses in src/checkout/Pay.tsx", "Uses in src/settings/Panel.tsx"]);
  });

  it("writes a search to the URL and narrows the files", async () => {
    await show(button.id);
    fireEvent.change(screen.getByRole("textbox", { name: "Search files and props" }), { target: { value: "config" } });
    expect([query().get("find"), fileButtons()]).toEqual(["config", ["Uses in src/settings/config.tsx"]]);
  });

  it("removes one prop's filter from its pill and keeps the search", async () => {
    await show(button.id, "?find=src&sel=size~value~large");
    fireEvent.click(screen.getByRole("button", { name: "Remove the filter size = large" }));
    expect([query().get("find"), query().get("sel")]).toEqual(["src", null]);
  });

  it("clears the props and folder filters, keeps the search and focuses it", async () => {
    await show(button.id, "?find=src&sel=size~value~large&area=src%2Fsettings");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);
    expect([query().get("find"), query().get("sel"), query().get("area")]).toEqual(["src", null, null]);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search files and props" }));
  });

  it("writes the sort to the URL", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: /^File/ }));
    expect([query().get("sort"), fileButtons()[0]]).toEqual(["file~asc", "Uses in src/settings/config.tsx"]);
  });

  it("says when a search matches nothing, clears it and focuses the search", async () => {
    await show(button.id, "?find=zzz");
    expect(screen.getByText("No uses match this search.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1) as HTMLElement);
    expect(query().get("find")).toBeNull();
    const search = screen.getByRole("textbox", { name: "Search files and props" });
    expect([search, document.activeElement]).toEqual([expect.objectContaining({ value: "" }), search]);
  });

  it("copies the calls in view, each call site once", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await show(button.id, "?sel=size~value~large");
    fireEvent.click(screen.getByRole("button", { name: "Copy the list of 2 files" }));
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text.startsWith("Button in shop: 4 uses in 2 files\nFilters: size = large\n")).toBe(true);
    expect(text).toContain("- src/checkout/Pay.tsx:6 ");
    expect(text).toContain("- src/settings/Panel.tsx:5, 9 ");
    expect(text).toContain("View in Scout: http://");
  });

  it("copies one folder's calls from its heading, and only that button reads Copied", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await show(card.id);
    fireEvent.click(screen.getByRole("button", { name: "Copy the list of 13 files in odd" }));
    const lines = (writeText.mock.calls[0]?.[0] as string).split("\n");
    const files = lines.filter(line => line.startsWith("- "));
    expect([lines[0], files.length, new Set(files.map(line => line.split("/").slice(0, 3).join("/")))]).toEqual(["Card in shop, folder src/cards/odd: 13 uses in 13 files", 13, new Set(["- src/cards/odd"])]);
    expect([(await screen.findAllByText("Copied")).length, within(screen.getByRole("button", { name: "Copy the list of 13 files in odd" })).queryByText("Copied")?.tagName]).toEqual([1, "SPAN"]);
  });

  it("keeps a file row the reader opened open while a search takes the calls in view to 5 or fewer and back", async () => {
    await show(button.id);
    const expanded = (path: string) => screen.getByRole("button", { name: `Uses in ${path}` }).getAttribute("aria-expanded");
    fireEvent.click(screen.getByRole("button", { name: "Uses in src/checkout/Pay.tsx" }));
    const search = screen.getByRole("textbox", { name: "Search files and props" });
    fireEvent.change(search, { target: { value: "checkout" } });
    const narrowed = expanded("src/checkout/Pay.tsx");
    fireEvent.change(search, { target: { value: "" } });
    expect([narrowed, expanded("src/checkout/Pay.tsx"), expanded("src/settings/Panel.tsx")]).toEqual(["true", "true", "false"]);
  });

  it("lists where it's used with each folder's calls", async () => {
    await show(button.id);
    expect(screen.getByRole("heading", { name: "Where it’s used" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Folder / }).map(row => row.getAttribute("aria-label"))).toEqual(["Folder checkout, 3 uses", "Folder settings, 3 uses", "Folder home, 1 use"]);
  });

  it.each<[string, Component, boolean]>([
    ["lists Prop values for a component with props", button, true],
    ["leaves Prop values out for a component that declares no props and whose uses set none", badge, false],
  ])("%s", async (_title, shown, listed) => {
    await show(shown.id);
    const fold = listed ? "Where it’s used and prop values" : "Where it’s used";
    expect([screen.queryByRole("heading", { name: "Prop values" }) !== null, screen.getByRole("button", { name: fold })]).toEqual([listed, expect.anything()]);
  });

  it("lists the packages it's used in when its calls span more than one, and filters by one", async () => {
    await show(link.id);
    expect(screen.getByRole("heading", { name: "Used in" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Package / }).map(row => row.getAttribute("aria-label"))).toEqual(["Package @example/web, 4 uses", "Package @example/admin, 2 uses"]);
    expect(screen.getByRole("button", { name: "Package @example/admin, 2 uses" })).toHaveAttribute("title", "@example/admin");
    fireEvent.click(screen.getByRole("button", { name: "Package @example/admin, 2 uses" }));
    expect(query().get("area")).toBe("@example/admin");
    expect(screen.getByRole("button", { name: "Remove the filter package @example/admin" })).toBeInTheDocument();
  });

  it("gives a package's scope a short form, @…, for a row too narrow for its whole name", async () => {
    await show(link.id);
    const name = screen.getByRole("button", { name: /^Package @example\/admin,/ }).firstElementChild?.firstElementChild as HTMLElement;
    expect(name.style.getPropertyValue("--chars")).toBe("14");
    expect([...name.children].map(part => [part.textContent, part.className.match(/if-name-\w+/)?.[0] ?? null])).toEqual([
      ["@example", "if-name-fits"],
      ["@…", "if-name-overflows"],
      ["/admin", null],
    ]);
  });

  it("names the one package its calls are in above their folders", async () => {
    await show(chip.id);
    const heading = screen.getByRole("heading", { name: "Used in" });
    expect(within(heading.parentElement as HTMLElement).getByText("@example/web")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Folder / }).map(row => row.getAttribute("aria-label"))).toEqual(["Folder home, 2 uses", "Folder cart, 1 use"]);
  });

  it("opens every file row from Expand all rows", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Expand all rows" }));
    expect(screen.getAllByRole("button", { name: /^Uses in / }).map(row => row.getAttribute("aria-expanded"))).toEqual(["true", "true", "true", "true"]);
  });

  it("filters by a folder from the column", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: "Folder home, 1 use" }));
    expect([query().get("area"), fileButtons()]).toEqual(["src/home", ["Uses in src/home/Hero.tsx"]]);
    expect(screen.getByRole("button", { name: "Remove the filter folder home" })).toBeInTheDocument();
  });

  it("focuses the one-folder sentence when unpicking a folder leaves one folder in view", async () => {
    await show(button.id, "?area=src%2Fhome&find=hero");
    const folder = screen.getByRole("button", { name: "Folder home, 1 use" });
    folder.focus();
    fireEvent.click(folder);
    expect(document.activeElement).toBe(screen.getByText(/^The only use is in/));
  });

  it("filters by two values of one prop, matching either", async () => {
    await show(button.id);
    fireEvent.click(screen.getByRole("button", { name: /^size, set on 6 of 7 uses/ }));
    fireEvent.click(screen.getByRole("button", { name: "size large, 4 uses" }));
    fireEvent.click(screen.getByRole("button", { name: "size small, 2 uses" }));
    expect([query().get("sel"), document.body.textContent?.includes("6 of 7 uses")]).toEqual(["size~value~large,size~value~small", true]);
  });

  it("lists styling, events and attributes in their own sections", async () => {
    await show(button.id);
    for (const [section, name] of [["Styling", "className"], ["Events", "onClick"], ["Attributes", "data-testid"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: section }));
      expect(screen.getByRole("button", { name: new RegExp(`^${name},`) })).toBeInTheDocument();
    }
  });

  it("moves a prop no call in view sets to Not set", async () => {
    await show(button.id, "?area=src%2Fhome");
    fireEvent.click(screen.getByRole("button", { name: /^Not set/ }));
    expect(screen.getByRole("button", { name: /^size/ })).toBeInTheDocument();
  });

  it("keeps a prop the link filtered open after its last value is unpicked", async () => {
    await show(button.id, "?sel=size~value~large");
    fireEvent.click(screen.getByRole("button", { name: "size large, 4 uses" }));
    expect([query().get("sel"), screen.getByRole("button", { name: /^size, set on/ }).getAttribute("aria-expanded")]).toEqual([null, "true"]);
  });

  it("opens Not set on a filtered prop that moves there when its last value is unpicked, and focuses its line", async () => {
    await show(button.id, "?area=src%2Fhome&sel=size~value~large");
    const pressed = screen.getByRole("button", { name: "size large, 0 uses" });
    pressed.focus();
    fireEvent.click(pressed);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "size, set on 0 of 1 use" }));
  });

  it("focuses the search on /", async () => {
    await show(button.id);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search files and props" }));
  });

  it("opens the filter panel and moves focus into it on F, but not while typing in the search", async () => {
    await show(button.id);
    const search = screen.getByRole("textbox", { name: "Search files and props" });
    search.focus();
    fireEvent.keyDown(search, { key: "f" });
    expect([document.activeElement, screen.getByRole("button", { name: "Where it’s used and prop values" }).getAttribute("aria-expanded")]).toEqual([search, "false"]);
    fireEvent.keyDown(document.body, { key: "f" });
    expect(screen.getByRole("button", { name: "Where it’s used and prop values" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("usage-column-body")?.contains(document.activeElement)).toBe(true);
  });

  it("says a component with no calls has none, and lists its declared props", async () => {
    await show(unused.id);
    expect(document.body).toHaveTextContent("This scan found no uses of Unused in shop.");
    expect(screen.getByRole("link", { name: "Open the definition" }).getAttribute("href")).toContain("src/Unused.tsx");
    expect(document.body).toHaveTextContent("Default sm");
  });

  it("opens every file of a component with 5 uses or fewer, without a search or Filter button", async () => {
    await show(badge.id);
    expect([screen.queryByRole("textbox", { name: "Search files and props" }), screen.queryByRole("button", { name: /^Filter/ })]).toEqual([null, null]);
    expect(screen.getByText(":8")).toBeInTheDocument();
  });

  it.each<[string, Component, boolean]>([
    ["with 5 uses or fewer", badge, false],
    ["with more than 5 uses", button, true],
  ])("pins the file list's header and folder heading only %s", async (_title, shown, pinned) => {
    await show(shown.id);
    const heads = [screen.getByRole("columnheader", { name: /^File/ }), document.querySelector('th[scope="rowgroup"]')];
    expect(heads.map(th => th?.classList.contains("sticky"))).toEqual([pinned, pinned]);
  });

  it("counts a deprecated component's calls as still to migrate", async () => {
    await show(oldButton.id);
    expect(document.body).toHaveTextContent("still to migrate");
    expect(screen.getByRole("heading", { name: "Where it’s still used" })).toBeInTheDocument();
  });

  it("moves focus to the next filter after removing one", async () => {
    await show(button.id, "?sel=size~value~large,variant~value~ghost");
    fireEvent.click(screen.getByRole("button", { name: "Remove the filter size = large" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove the filter variant = ghost" }));
  });
});
