import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { Occurrence } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../dist/cli.js");

describe("integration: a Vue template tag reading a member of an imported head", () => {
  let dir = "";
  let occurrences: Occurrence[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-vue-dotted-member-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "vue-app", private: true, dependencies: { "@example/lib": "1.0.0" } }),
      "node_modules/@example/lib/package.json": JSON.stringify({ name: "@example/lib", version: "1.0.0", main: "index.js" }),
      "node_modules/@example/lib/index.js": "export const Button = {};\nexport const useThing = () => ({});\n",
      "scout.config.json": JSON.stringify({
        repoId: "vue-app",
        include: ["src/**/*.vue", "src/**/*.ts"],
      }),
      "src/Provable.vue": [
        "<template>",
        '  <UI.Missing label="a" />',
        '  <Named.Item label="b" />',
        '  <Named label="c" />',
        '  <MenuObj.Missing label="d" />',
        "</template>",
        '<script setup lang="ts">',
        'import * as UI from "./ui/index";',
        'import { Named, MenuObj } from "./menu-obj";',
        "</script>",
        "",
      ].join("\n"),
      "src/Unprovable.vue": [
        "<template>",
        '  <NsAlias.Button label="a" />',
        '  <Made.Button label="b" />',
        '  <Anon.Item label="c" />',
        '  <TwoPkg.Btn label="d" />',
        '  <ViaOut.Out label="e" />',
        '  <LazyObj.Item label="f" />',
        '  <Opaque.Item label="g" />',
        '  <Spread.Item label="h" />',
        '  <Computed.Item label="i" />',
        '  <TabsX.Pane label="j" />',
        '  <FnMenu.Item label="k" />',
        '  <ClsMenu.Item label="l" />',
        '  <AsAny.Pane label="m" />',
        '  <Inst.Pane label="n" />',
        '  <Merged.Item label="o" />',
        '  <Seeded.Item label="p" />',
        "</template>",
        '<script setup lang="ts">',
        'import { NsAlias } from "./ns-alias";',
        'import { Made } from "./made";',
        'import Anon from "./anon";',
        'import * as TwoPkg from "./two/twopkg";',
        'import * as ViaOut from "./two/viaout";',
        'import LazyObj from "./lazyobj";',
        'import { Opaque, Spread, Computed, Merged, Seeded } from "./objects";',
        'import TabsX from "./tabs";',
        'import { FnMenu } from "./fnassign";',
        'import { ClsMenu } from "./cls";',
        'import { AsAny } from "./asany";',
        'import { Inst } from "./install";',
        "</script>",
        "",
      ].join("\n"),
      "src/Menu.vue": "<template><ul><slot /></ul></template>\n",
      "src/MenuItem.vue": "<template><li><slot /></li></template>\n",
      "src/menu-obj.ts": 'import Root from "./Menu.vue";\nimport Item from "./MenuItem.vue";\nexport const MenuObj = { Root, Item };\n',
      "src/ui/index.ts": 'export { default as Button } from "./Button.vue";\nexport * from "../parts/index";\n',
      "src/ui/Button.vue": "<template><button><slot /></button></template>\n",
      "src/parts/index.ts": 'export { default as Part } from "./Part.vue";\n',
      "src/parts/Part.vue": "<template><i /></template>\n",
      "src/ns-alias.ts": 'import * as Lib from "@example/lib";\nexport const NsAlias = Lib;\n',
      "src/made.ts": 'import { useThing } from "@example/lib";\nexport const Made = useThing();\n',
      "src/anon.ts": 'import Menu from "./Menu.vue";\nimport Item from "./MenuItem.vue";\nexport default Object.assign(Menu, { Item });\n',
      "src/two/twopkg.ts": 'export * from "@example/a";\nexport * from "@example/b";\n',
      "src/two/viaout.ts": 'export * from "../../outside/index";\n',
      "src/lazyobj.ts": 'import { defineAsyncComponent } from "vue";\nexport default { Item: defineAsyncComponent(() => import("./MenuItem.vue")) };\n',
      "src/objects.ts": [
        'import Root from "./Menu.vue";',
        'import Item from "./MenuItem.vue";',
        "declare function makeThing(): unknown;",
        'const key = "Item";',
        "const parts = { Item };",
        "export const Opaque = { Item: makeThing() };",
        "export const Spread = { ...parts, Root };",
        "export const Computed = { [key]: Item };",
        "export const Merged = Object.assign({}, parts);",
        "export const Seeded = Object.assign({ Root }, parts);",
        "",
      ].join("\n"),
      "src/Tabs.vue": "<template><div><slot /></div></template>\n",
      "src/Pane.vue": "<template><div><slot /></div></template>\n",
      "src/tabs.ts": 'import Tabs from "./Tabs.vue";\nimport Pane from "./Pane.vue";\nTabs.Pane = Pane;\nexport default Tabs;\n',
      "src/fnassign.ts": 'import Item from "./MenuItem.vue";\nexport function FnMenu() { return null; }\nObject.assign(FnMenu, { Item });\n',
      "src/cls.ts": 'import Item from "./MenuItem.vue";\nexport class ClsMenu { static Item = Item; }\n',
      "src/Sheet.vue": "<template><div><slot /></div></template>\n",
      "src/asany.ts": 'import Sheet from "./Sheet.vue";\nimport Pane from "./Pane.vue";\n(Sheet as any).Pane = Pane;\nexport { Sheet as AsAny };\n',
      "src/install.ts": 'import Pane from "./Pane.vue";\nexport function Inst() { return null; }\nexport function install() { Inst.Pane = Pane; }\n',
      "outside/index.ts": 'export { default as Out } from "./Out.vue";\n',
      "outside/Out.vue": "<template><b /></template>\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    await exec("node", [cli, "scan", "--quiet", "--dry-run"], { cwd: dir });
    occurrences = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8"))).occurrences;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("observes a member or export the head provably lacks as unbound-name, naming the tag as written", () => {
    expect(
      occurrences.filter((o) => o.filePath === "src/Provable.vue").map((o) => [o.line, o.resolution, o.trace]),
    ).toEqual([
      [2, { status: "unresolved", reason: { kind: "unbound-name", name: "UI.Missing" } }, [{ kind: "import", specifier: "./ui/index", name: "*" }]],
      [3, { status: "unresolved", reason: { kind: "unbound-name", name: "Named.Item" } }, [{ kind: "import", specifier: "./menu-obj", name: "Named" }]],
      [4, { status: "unresolved", reason: { kind: "unbound-name", name: "Named" } }, [{ kind: "import", specifier: "./menu-obj", name: "Named" }]],
      [5, { status: "unresolved", reason: { kind: "unbound-name", name: "MenuObj.Missing" } }, [{ kind: "import", specifier: "./menu-obj", name: "MenuObj" }]],
    ]);
  });

  it("claims nothing for a member the scan cannot follow the head to, or that it names but does not credit", () => {
    expect(occurrences.filter((o) => o.filePath === "src/Unprovable.vue")).toEqual([]);
  });
});
