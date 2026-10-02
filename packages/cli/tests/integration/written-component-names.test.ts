import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../dist/cli.js");

describe("integration: the name a file renders a component under", () => {
  let dir = "";
  let artifact: ScanArtifact;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-written-component-names-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "app", private: true, dependencies: { "@example/link": "1.0.0" } }),
      "scout.config.json": JSON.stringify({ repoId: "app", include: ["src/**/*.{tsx,vue}"] }),
      "node_modules/@example/link/package.json": JSON.stringify({ name: "@example/link", version: "1.0.0", main: "index.js" }),
      "node_modules/@example/link/index.js": "export default function Link() { return null; }\n",
      "src/components/Header.tsx": "export default function Header() { return <header />; }\n",
      "src/components/Badge.tsx": "export function Badge() { return <span />; }\n",
      "src/pages/Settings.tsx": [
        'import SettingsHeader from "../components/Header";',
        'import { Badge as StatusBadge } from "../components/Badge";',
        'import Link from "@example/link";',
        "",
        "export function Settings() {",
        "  return (",
        "    <main>",
        "      <SettingsHeader />",
        "      <StatusBadge />",
        "      <Link />",
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "src/pages/Account.tsx": [
        'import PageHeader from "../components/Header";',
        'import SettingsHeader from "../components/Header";',
        "",
        "export function Account() {",
        "  return (",
        "    <main>",
        "      <PageHeader />",
        "      <SettingsHeader />",
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "src/pages/Home.tsx": [
        'import Header from "../components/Header";',
        'import { Badge } from "../components/Badge";',
        "",
        "export function Home() {",
        "  return (",
        "    <main>",
        "      <Header />",
        "      <Badge />",
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "src/vue/PanelHeader.vue": "<template><header><slot /></header></template>\n",
      "src/vue/Panel.vue": [
        "<template>",
        "  <section>",
        "    <panel-header />",
        "    <TitleBar />",
        "  </section>",
        "</template>",
        "<script setup>",
        'import panelHeader from "./PanelHeader.vue";',
        'import TitleBar from "./PanelHeader.vue";',
        "</script>",
        "",
      ].join("\n"),
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    await exec("node", [cli, "scan", "--quiet", "--dry-run"], { cwd: dir });
    artifact = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8")));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records the written name only where it differs from the component's declared name", () => {
    const identityOf = new Map(artifact.components.map((c) => [c.id, c.identity]));
    const header = { kind: "repository-declaration", repoId: "app", filePath: "src/components/Header.tsx", exportName: "Header" };
    const badge = { kind: "repository-declaration", repoId: "app", filePath: "src/components/Badge.tsx", exportName: "Badge" };
    const link = { kind: "package-export", packageName: "@example/link", publicEntry: "", exportName: "default" };
    const panelHeader = { kind: "repository-declaration", repoId: "app", filePath: "src/vue/PanelHeader.vue", exportName: "PanelHeader" };
    expect(
      artifact.occurrences
        .map((o) => ({
          site: `${o.filePath}:${o.line}`,
          component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
          writtenName: o.writtenName,
        }))
        .sort((a, b) => a.site.localeCompare(b.site, "en", { numeric: true })),
    ).toEqual([
      { site: "src/pages/Account.tsx:7", component: header, writtenName: "PageHeader" },
      { site: "src/pages/Account.tsx:8", component: header, writtenName: "SettingsHeader" },
      { site: "src/pages/Home.tsx:7", component: header, writtenName: undefined },
      { site: "src/pages/Home.tsx:8", component: badge, writtenName: undefined },
      { site: "src/pages/Settings.tsx:8", component: header, writtenName: "SettingsHeader" },
      { site: "src/pages/Settings.tsx:9", component: badge, writtenName: "StatusBadge" },
      { site: "src/pages/Settings.tsx:10", component: link, writtenName: "Link" },
      { site: "src/vue/Panel.vue:3", component: panelHeader, writtenName: undefined },
      { site: "src/vue/Panel.vue:4", component: panelHeader, writtenName: "TitleBar" },
    ]);
  });

  it("lists each component's written names on the component, most used first", () => {
    expect(
      artifact.components
        .map((c) => [c.identity.kind === "tag" ? c.identity.tagName : c.identity.exportName, c.writtenNames])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["Account", undefined],
      ["Badge", ["StatusBadge"]],
      ["default", ["Link"]],
      ["Header", ["SettingsHeader", "PageHeader"]],
      ["Home", undefined],
      ["Panel", undefined],
      ["PanelHeader", ["TitleBar"]],
      ["Settings", undefined],
    ]);
  });
});
