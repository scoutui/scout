import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Entry points that change something and must check access with can(). */
const CHECKED = [
  "charts/dashboard-actions.ts#saveDashboard",
  "charts/dashboard-actions.ts#deleteDashboard",
  "charts/dashboard-actions.ts#previewDashboard",
  "charts/dashboard-actions.ts#pickableForRepo",
  "governance/governance-actions.ts#saveGovernance",
  "governance/governance-actions.ts#deleteGovernance",
  "packages/tag-actions.ts#saveTag",
  "packages/tag-actions.ts#deleteTag",
  "packages/tag-actions.ts#quickTagPackage",
  "settings/people-actions.ts#changeRole",
  "settings/people-actions.ts#removeFromPeople",
  "login/device/actions.ts#approveDevice",
  "login/device/actions.ts#denyDevice",
  "login/device/actions.ts#switchDeviceAccount",
  "login/device/page.tsx#handleApprove",
  "login/device/page.tsx#handleDeny",
  "login/device/page.tsx#handleSwitch",
  "api/scans/route.ts#POST",
  "api/scans/preflight/route.ts#POST",
];
/** Sign-in and sign-out flows: they run before anyone has a role. */
const SIGN_IN_FLOWS = [
  "api/auth/[...nextauth]/route.ts#POST",
  "api/auth/backchannel-logout/route.ts#POST",
  "api/auth/cli/device-code/route.ts#POST",
  "api/auth/cli/token/route.ts#POST",
  "api/auth/cli/session/route.ts#DELETE",
];

const SRC = join(__dirname, "../../src");
const APP = join(SRC, "app");
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const srcFiles = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));

function parse(path: string): ts.SourceFile {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

function isUseServer(statement: ts.Statement | undefined): boolean {
  return (
    statement !== undefined &&
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === "use server"
  );
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

/** Each exported function or variable in `file`: its name and the node holding its code. */
function exportedValues(file: ts.SourceFile): Array<[string, ts.Node]> {
  const values: Array<[string, ts.Node]> = [];
  for (const statement of file.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      values.push([statement.name.text, statement.body ?? statement]);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const code = declaration.initializer ?? declaration;
      if (ts.isIdentifier(declaration.name)) values.push([declaration.name.text, code]);
      if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          if (ts.isIdentifier(element.name)) values.push([element.name.text, code]);
        }
      }
    }
  }
  return values;
}

/** Each function in `file` whose body starts with `"use server"`: its name and its body. */
function inlineServerFunctions(file: ts.SourceFile): Array<[string, ts.Node]> {
  const found: Array<[string, ts.Node]> = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      isUseServer(node.body.statements[0])
    ) {
      const name =
        node.name && ts.isIdentifier(node.name)
          ? node.name.text
          : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
            ? node.parent.name.text
            : `line ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      found.push([name, node.body]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Every server action and API write route under src/app, keyed `<path from src/app>#<name>`, with its code. */
function entryPoints(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const path of srcFiles.filter((p) => p.startsWith(APP + sep) && /\.tsx?$/.test(p))) {
    const file = parse(path);
    const at = relative(APP, path);
    const found = inlineServerFunctions(file);
    if (isUseServer(file.statements[0])) found.push(...exportedValues(file));
    if (basename(path) === "route.ts") {
      found.push(...exportedValues(file).filter(([name]) => WRITE_METHODS.has(name)));
    }
    for (const [name, code] of found) entries.set(`${at}#${name}`, code.getText(file));
  }
  return entries;
}

function filesMatching(pattern: RegExp): string[] {
  return srcFiles.filter((path) => pattern.test(readFileSync(path, "utf8"))).map((path) => relative(SRC, path));
}

const nameOf = (key: string) => key.slice(key.indexOf("#") + 1);

describe("access checks", () => {
  const entries = entryPoints();

  it("lists every server action and API write route", () => {
    const listed = new Set([...CHECKED, ...SIGN_IN_FLOWS]);
    const unlisted = [...entries.keys()].filter((key) => !listed.has(key));
    expect(
      unlisted.map(
        (key) =>
          `${key} changes something but isn't in access-guard.test.ts. Check access with can() and add it to CHECKED.`,
      ),
    ).toEqual([]);
    const gone = [...listed].filter((key) => !entries.has(key));
    expect(gone.map((key) => `${key} is in access-guard.test.ts but not in the code. Remove it from the list.`)).toEqual(
      [],
    );
    expect(CHECKED.filter((key) => SIGN_IN_FLOWS.includes(key))).toEqual([]);
  });

  it("calls can(), requireEditor() or another checked action in every checked entry point", () => {
    const unchecked = CHECKED.filter((key) => {
      const others = CHECKED.map(nameOf).filter((name) => name !== nameOf(key));
      return !new RegExp(`\\b(${["can", "requireEditor", ...others].join("|")})\\(`).test(entries.get(key) ?? "");
    });
    expect(unchecked.map((key) => `${key} doesn't check access. Check it with can() before changing anything.`)).toEqual(
      [],
    );
  });

  it("checks the role with can() in requireEditor", () => {
    const requireEditor = exportedValues(parse(join(SRC, "lib/identity.ts"))).find(
      ([name]) => name === "requireEditor",
    );
    expect(requireEditor?.[1].getText()).toMatch(/\bcan\(/);
  });

  it("lets only a signed-in browser person who can view approve, deny or switch a CLI sign-in", () => {
    for (const name of ["approveDevice", "denyDevice", "switchDeviceAccount"]) {
      const code = entries.get(`login/device/actions.ts#${name}`) ?? "";
      const identified = code.indexOf("identify({ browser: true })");
      expect(identified, name).toBeGreaterThanOrEqual(0);
      expect(code.indexOf('can(identity, "view")', identified), name).toBeGreaterThan(identified);
    }
  });

  it("never links accounts that share an email", () => {
    expect(filesMatching(/allowDangerousEmailAccountLinking/)).toEqual([]);
  });

  it("only adds to and reads the role history, never updates or deletes it", () => {
    expect(filesMatching(/\.insert\(roleChanges\)/)).not.toEqual([]);
    expect(filesMatching(/\.(update|delete)\(\s*(schema\.)?roleChanges/)).toEqual([]);
    expect(filesMatching(/(UPDATE|DELETE FROM)\s+"?role_changes/i)).toEqual([]);
  });
});
