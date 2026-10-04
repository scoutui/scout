import { basename, extname } from "node:path";
import type { RootNode, TemplateChildNode } from "@vue/compiler-core";
import { canonicalTagName, isValidCustomElementName, MODULE_SCOPE } from "@scoutui/reference-graph";
import type { FileBuilder } from "@scoutui/reference-graph";
import type { VueParseWrapper } from "./parse-sfc.js";
import { partsFromWrapper, VueNode } from "./parse-sfc.js";
import { readAttrs } from "./read-attrs.js";
import { declaresOptions, exportsBesideDefault, scriptOnlyBindings } from "./script-bindings.js";
import { extractScriptImports } from "./script-imports.js";
import type { ImportSpec } from "./script-imports.js";

/**
 * Vue tag-form enumeration. A script-bound import resolves both via its
 * lowercased exact form (`Card` → `card`) and its PascalCase→kebab form
 * (`VBtn` → `v-btn`). Pre-computed once per import.
 */
export function vueTagForms(importName: string): string[] {
  const lowercased = importName.toLowerCase();
  const kebab = importName
    .replace(/([A-Za-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  return Array.from(new Set([lowercased, kebab]));
}

/**
 * Vue's own built-in components, as Vue itself seeds them into the type-level
 * `GlobalComponents` interface: `Teleport`, `Suspense`, `KeepAlive` and
 * `BaseTransition` from `@vue/runtime-core`, `Transition` and
 * `TransitionGroup` from `@vue/runtime-dom`, plus the `<component :is>`
 * special element the compiler handles inline. They are language constructs
 * with no package and no definition file, so they are neither a component
 * usage nor a resolution miss.
 */
const VUE_BUILTIN_TAGS = new Set(
  [
    "Teleport",
    "Transition",
    "TransitionGroup",
    "KeepAlive",
    "Suspense",
    "BaseTransition",
    "Component",
  ].flatMap(vueTagForms),
);

/**
 * True for a lowercased tag naming a Vue built-in, in either the
 * PascalCase (`<KeepAlive>` → `keepalive`) or kebab (`<keep-alive>`) form Vue
 * accepts. `<KeepAlive>` lowercases to the same string as an authored
 * `<keepalive>`, which Vue itself does not accept, so that spelling is
 * treated as the built-in too.
 *
 * Checked first, ahead of every resolution lane, because Vue does the same:
 * `resolveComponentType` returns on
 * `isCoreComponent(tag) || context.isBuiltInComponent(tag)` before it ever
 * consults `resolveSetupReference` (`@vue/compiler-core`). A repo that
 * imports a component named `Transition` and writes `<Transition>` renders
 * Vue's built-in, not the import, so crediting that call site to the
 * import would report usage of a component the page never mounts.
 */
function isVueBuiltinTag(lowercasedTag: string): boolean {
  return VUE_BUILTIN_TAGS.has(lowercasedTag);
}

/** One auto-import manifest entry: the synthetic import to emit for a tag. */
export type AutoImportComponent = { specifier: string; imported: string; name: string };

export type EmitVueTemplateOpts = {
  file: string;
  wrapper: VueParseWrapper;
  fileBuilder: FileBuilder;
  /**
   * Auto-import lookup for template tags with no script binding, consulted
   * before the hyphenated custom-element lane. A hit emits a synthetic import
   * and JsxUsage, exactly what an explicit script import of the same component
   * would produce, so the engine treats both alike. Keys are lowercased tag
   * forms (see `vueTagForms`).
   */
  resolveAutoImport?: (tagForm: string) => AutoImportComponent | undefined;
  /**
   * Pre-resolved SFC component symbol; defaults to the filename stem (e.g.
   * `button` for `button.vue`). The CLI passes the symbol `detectVueComponents`
   * resolves (from `defineOptions`, else a PascalCase filename) so the SFC's
   * seed id and the engine's owner ComponentId hash to the same value. A
   * mismatch prunes the SFC seed as an unreachable local.
   */
  sfcSymbol?: string;
};

/**
 * Emitter for Vue SFC templates. It walks the template AST Vue's own compiler
 * parsed, so elements begin and end where Vue reads them: a self-closing tag
 * closes, and a `<textarea>` or `<select>` holds its children as elements.
 */
export function emitVueTemplate(opts: EmitVueTemplateOpts): void {
  const parts = partsFromWrapper(opts.wrapper);

  // The SFC's default export is the component itself: declare it as a
  // JSX-returning function with a default export so the engine can credit
  // template usages to this SFC as their owner. Options a script declares
  // become members of the component object, which the graph does not record.
  const sfcSymbol = opts.sfcSymbol ?? basename(opts.file, extname(opts.file));
  opts.fileBuilder.addDeclaration({
    symbol: sfcSymbol,
    value: { kind: "Function", returns: [{ kind: "JSX" }], ...(declaresOptions(opts.wrapper) ? { openMembers: true } : {}) },
    loc: { line: 1, column: 1 },
    isExported: true,
  });
  opts.fileBuilder.addExport({ kind: "default", local: sfcSymbol });
  if (exportsBesideDefault(opts.wrapper)) opts.fileBuilder.markUnrecordedExports();

  // Both script blocks' imports are recorded whether or not the template emits
  // anything: the engine looks up imports by local name to resolve template tags.
  let importSpecs: ImportSpec[] = [];
  if (parts.scriptSource && opts.wrapper.scriptProgram) {
    importSpecs = [opts.wrapper.scriptProgram, opts.wrapper.plainScriptProgram].flatMap((program) =>
      program === undefined ? [] : extractScriptImports({ file: opts.file, program }).importSpecs,
    );
    for (const spec of importSpecs) {
      opts.fileBuilder.addImport({
        specifier: spec.source,
        imported: spec.imported,
        local: spec.local,
        // Placeholder: script-imports.ts records no import positions.
        loc: { line: 1, column: 1 },
      });
    }
  }

  const templateAst = opts.wrapper.descriptor.template?.ast;
  if (!templateAst) return;

  // Every template usage is owned by the SFC's own declaration (above).
  // `resolveOwnerChain` needs `originFile` to find that declaration: without
  // it the occurrence gets no ownerComponentId and the SFC seed is filtered
  // out as an unreachable local.
  const sfcOwnerRef = {
    symbol: sfcSymbol,
    scope: MODULE_SCOPE,
    memberChain: [],
    loc: { line: 1, column: 1 },
    originFile: opts.file,
  };

  // Template tag form → ImportSpec, for both forms `vueTagForms` gives, so
  // the walk does one Map lookup per element. The full spec lets owner
  // attribution stamp the specifier and import on the viaOverride.
  const scriptBindings = new Map<string, ImportSpec>();
  for (const spec of importSpecs) {
    for (const form of vueTagForms(spec.local)) {
      scriptBindings.set(form, spec);
    }
  }
  const scriptOnly = scriptOnlyBindings(opts.wrapper);
  const scriptOnlyForms = new Set([...scriptOnly].flatMap(vueTagForms));

  // Per-SFC dedup so a repeated auto-imported tag (`<FooCard>` used twice)
  // emits its synthetic import once, matching how a real script import only
  // appears once regardless of template usage count.
  const syntheticImports = new Set<string>();

  function visit(node: RootNode | TemplateChildNode): void {
    if (node.type === VueNode.ELEMENT) {
      const rawTag = node.tag.toLowerCase();
      const { line, column } = node.loc.start;
      const builtin = isVueBuiltinTag(rawTag);
      const scriptSpec = builtin ? undefined : scriptBindings.get(rawTag);
      const auto = builtin || scriptSpec ? undefined : opts.resolveAutoImport?.(rawTag);
      if (builtin) {
        // Vue built-in: not a component reference and not a miss, so emit
        // nothing and diagnose nothing.
      } else if (scriptSpec) {
        const { props, events } = readAttrs(node);
        opts.fileBuilder.addJsxUsage({
          ref: {
            symbol: scriptSpec.local,
            scope: MODULE_SCOPE,
            memberChain: [],
            loc: { line, column },
          },
          loc: { line, column },
          props,
          events,
        });
        // Owner is always the enclosing SFC; the viaOverride carries the
        // script import's specifier and name as the occurrence's provenance.
        opts.fileBuilder.setOwner(sfcOwnerRef, {
          kind: "vue-template",
          specifier: scriptSpec.source,
          import: scriptSpec.imported,
        });
      } else if (auto) {
        if (!syntheticImports.has(auto.name)) {
          syntheticImports.add(auto.name);
          // Synthetic import: models the import the auto-import mechanism
          // (e.g. Nuxt) inserts at build time. From here the usage is
          // indistinguishable from an explicitly-imported component.
          opts.fileBuilder.addImport({
            specifier: auto.specifier,
            imported: auto.imported,
            local: auto.name,
            loc: { line, column },
          });
        }
        const { props, events } = readAttrs(node);
        opts.fileBuilder.addJsxUsage({
          ref: { symbol: auto.name, scope: MODULE_SCOPE, memberChain: [], loc: { line, column } },
          loc: { line, column },
          props,
          events,
        });
        opts.fileBuilder.setOwner(sfcOwnerRef, {
          kind: "vue-template",
          specifier: auto.specifier,
          import: auto.imported,
        });
      } else if (isValidCustomElementName(canonicalTagName(rawTag)) && !scriptOnlyForms.has(rawTag)) {
        // A valid custom element name with no script binding: a custom
        // element, or Vue's auto-import / runtime global-component convention
        // (e.g. `<x-button>`, Vuetify's `<v-list>` when registered globally).
        // The engine credits it to the tag by name. A reserved name
        // (`<font-face>`) is not one and falls through below, and so does the
        // kebab-case form of a name in `scriptOnly`, which emits nothing.
        const { props, events } = readAttrs(node);
        opts.fileBuilder.addTagUsage({
          tagName: rawTag,
          loc: { line, column },
          props,
          events,
        });
        // Owner is the enclosing SFC. With no viaOverride, the engine sets the
        // occurrence's `via` to `{ kind: "html-tag" }` for a TagUsage.
        opts.fileBuilder.setTagOwner(sfcOwnerRef);
      } else {
        // Only an authored-uppercase tag is a component reference: a lowercase
        // unknown is non-standard HTML. No lane above binds it, so it is a usage
        // of its authored name, a dotted name reading a member of its head
        // (`UI.Button`): the engine resolves a head the script imports and
        // reports one nothing declares or imports as unbound. A head the script
        // binds where the graph cannot see it (`scriptOnlyBindings`) is no usage.
        const [head, ...members] = /^[A-Z][\w$]*(?:\.[\w$]+)*$/.test(node.tag) ? node.tag.split(".") : [];
        if (head !== undefined && !scriptOnly.has(head)) {
          const { props, events } = readAttrs(node);
          opts.fileBuilder.addJsxUsage({
            ref: { symbol: head, scope: MODULE_SCOPE, memberChain: members, loc: { line, column } },
            loc: { line, column },
            props,
            events,
          });
          opts.fileBuilder.setOwner(sfcOwnerRef);
        }
      }
      // Plain HTML (`<div>`, `<span>`) falls through without emission: never
      // tracked, never diagnosed.
    }
    if (node.type === VueNode.ROOT || node.type === VueNode.ELEMENT) {
      for (const child of node.children) visit(child);
    }
  }

  visit(templateAst);
}
