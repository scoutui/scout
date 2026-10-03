import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoundedDefinitionResolver } from "../../../src/walker/bounded-definition-resolver.js";

describe("createBoundedDefinitionResolver", () => {
  let stage: string;

  beforeAll(() => {
    stage = realpathSync(mkdtempSync(join(tmpdir(), "cc-bdr-")));
    mkdirSync(join(stage, "src"), { recursive: true });
    writeFileSync(join(stage, "src", "index.ts"), `export { Button } from "./button";\n`);
    writeFileSync(join(stage, "src", "button.tsx"), "export function Button() { return null; }\n");
    // Star-hop barrel: index2 → * from mid → named from button.
    writeFileSync(join(stage, "src", "index2.ts"), `export * from "./mid";\n`);
    writeFileSync(join(stage, "src", "mid.ts"), `export { Button as Btn } from "./button";\n`);
    // Cycle: a ↔ b.
    writeFileSync(join(stage, "src", "a.ts"), `export * from "./b";\n`);
    writeFileSync(join(stage, "src", "b.ts"), `export * from "./a";\n`);
  });

  afterAll(() => rmSync(stage, { recursive: true, force: true }));

  const moduleResolver = (_from: string, spec: string) => {
    if (!spec.startsWith(".")) return null;
    const base = join(stage, "src", spec.replace("./", ""));
    for (const cand of [`${base}.ts`, `${base}.tsx`]) {
      try {
        return realpathSync(cand);
      } catch {
        /* next */
      }
    }
    return null;
  };

  const firstParty = (abs: string) => abs.startsWith(stage);

  it("follows a named re-export barrel to the definition file", () => {
    const resolveDef = createBoundedDefinitionResolver({ moduleResolver, firstParty }).resolveDefinition;
    expect(resolveDef(join(stage, "src", "index.ts"), "Button", [])).toEqual({
      absFile: join(stage, "src", "button.tsx"),
      exportName: "Button",
      path: [],
      definition: { line: 1, column: 7 },
    });
  });

  it("follows star hops", () => {
    const resolveDef = createBoundedDefinitionResolver({ moduleResolver, firstParty }).resolveDefinition;
    expect(resolveDef(join(stage, "src", "index2.ts"), "Btn", [])).toEqual({
      absFile: join(stage, "src", "button.tsx"),
      exportName: "Button",
      path: [],
      definition: { line: 1, column: 7 },
    });
  });

  it("returns null on unresolvable names and survives cycles", () => {
    const resolveDef = createBoundedDefinitionResolver({ moduleResolver, firstParty }).resolveDefinition;
    expect(resolveDef(join(stage, "src", "a.ts"), "Nope", [])).toBeNull();
  });

  it("emits a diagnostic and best-effort pins when the file cap is hit", () => {
    // A chain longer than the cap: c0 → c1 → ... . Cap at 2 files forces a stop.
    mkdirSync(join(stage, "deep"), { recursive: true });
    for (let i = 0; i < 6; i++) {
      writeFileSync(
        join(stage, "deep", `c${i}.ts`),
        `export { Widget } from "./c${i + 1}";\n`,
      );
    }
    writeFileSync(join(stage, "deep", "c6.ts"), "export function Widget() { return null; }\n");
    const deepResolver = (_from: string, spec: string) => {
      if (!spec.startsWith(".")) return null;
      try {
        return realpathSync(join(stage, "deep", `${spec.replace("./", "")}.ts`));
      } catch {
        return null;
      }
    };
    const warnings: string[] = [];
    const resolveDef = createBoundedDefinitionResolver({
      moduleResolver: deepResolver,
      firstParty,
      maxFiles: 2,
      onWarning: (m) => warnings.push(m),
    }).resolveDefinition;
    const result = resolveDef(join(stage, "deep", "c0.ts"), "Widget", []);
    // Cap hit before reaching c6: best-effort pin to a hop target, with a warning.
    if (result === null || !("absFile" in result)) throw new Error(`expected a pin to a file, got ${JSON.stringify(result)}`);
    expect(result.absFile).toBe(join(stage, "deep", "c2.ts"));
    expect(warnings).toEqual([
      `Stopped following re-exports of "Widget" at ${join(stage, "deep", "c2.ts")}, so its occurrences are counted under that file.`,
    ]);
  });

  it("doesn't parse a package an `export *` names, so a repository `export *` after it is reached within the file cap", () => {
    const pkg = join(stage, "frontier", "node_modules", "@example", "ui");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(stage, "frontier", "barrel.ts"), `export * from "@example/ui";\nexport * from "./local";\n`);
    writeFileSync(join(stage, "frontier", "local.tsx"), "export function Spinner() { return null; }\n");
    writeFileSync(join(pkg, "index.js"), "export function Tooltip() { return null; }\n");
    const targets: Record<string, string> = {
      "@example/ui": join(pkg, "index.js"),
      "./local": join(stage, "frontier", "local.tsx"),
    };
    const resolveDef = createBoundedDefinitionResolver({
      moduleResolver: (_from, spec) => targets[spec] ?? null,
      firstParty: (abs) => abs.startsWith(stage) && !abs.includes("/node_modules/"),
      maxFiles: 2,
    }).resolveDefinition;
    expect(resolveDef(join(stage, "frontier", "barrel.ts"), "Spinner", [])).toMatchObject({
      absFile: join(stage, "frontier", "local.tsx"),
      exportName: "Spinner",
    });
  });

  it("emits the same diagnostic and pins to the hop when the next file can't be read", () => {
    mkdirSync(join(stage, "gone"), { recursive: true });
    writeFileSync(join(stage, "gone", "entry.ts"), `export { Widget } from "./missing";\n`);
    const missing = join(stage, "gone", "missing.ts");
    const warnings: string[] = [];
    const resolveDef = createBoundedDefinitionResolver({
      moduleResolver: (_from, spec) => (spec === "./missing" ? missing : null),
      firstParty,
      onWarning: (m) => warnings.push(m),
    }).resolveDefinition;
    const result = resolveDef(join(stage, "gone", "entry.ts"), "Widget", []);
    expect(result).toMatchObject({ absFile: missing, exportName: "Widget" });
    expect(warnings).toEqual([`Stopped following re-exports of "Widget" at ${missing}, so its occurrences are counted under that file.`]);
  });
});
