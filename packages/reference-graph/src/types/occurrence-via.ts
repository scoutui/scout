/**
 * Discriminated union describing how a component instance was used: one hop
 * of an engine occurrence's provenance chain (`viaChain`).
 */
export type OccurrenceVia =
  | { kind: "html-tag" }
  | { kind: "react-wrapper"; specifier: string; import: string }
  | { kind: "direct-import"; specifier: string; import: string }
  | { kind: "vue-template"; specifier: string; import: string }
  // Compound JSX rooted in a locally-declared `createContext()` / `React.createContext()`
  // binding (e.g. `<MyContext.Provider>`). The component identity uses the local
  // lane (`source.type === "local"`); this `via` kind is the filterable signal so
  // downstream queries can separate "real" local components from React Context
  // patterns. No `specifier`: the binding is local, not imported.
  | { kind: "context-provider" }
  // JSX usage of a locally-declared variable bound to a React-API factory
  // (`forwardRef`, `memo`, `lazy`, plus `React.*` member-expression callees).
  // Identity uses `source.type === "local"`; this `via` kind is the filterable
  // signal for var-bound locals (vs function/class-declared locals which use
  // `direct-import`). No `specifier`: the binding is local, not imported.
  | { kind: "local-component" }
  // HOC composition: const Enhanced = connect(...)(Foo) / flow(...)(Foo) /
  // withRouter(Foo). The folded-away wrapper is structurally invisible in
  // components[]; the access pattern lives here. hocCallee is the outer-most
  // wrapping call's identifier. specifier + import preserved from the wrapped
  // component's original import; absent when the wrapped value is not read
  // through an import (a binding declared in a file, an inline function).
  | { kind: "hoc-wrapper"; hocCallee: string; specifier?: string; import?: string }
  // Dynamic component map dispatch: const map = { foo: Foo }; const Comp = map[k].
  // mapName is the local name of the object literal. mapLoc points at the literal
  // so consumers can trace which dispatch site this occurrence came from.
  // mapLoc.file is repo-relative (matches occurrence.filePath convention).
  | { kind: "dynamic-map"; mapName: string; mapLoc: { file: string; line: number; column: number } }
  // Structural lazy/dynamic-import wrapper: const A = lazy(() => import("./foo")).
  // wrapperCallee is the wrapping HOF's identifier (telemetry only). specifier +
  // import are the resolved dynamic-import target.
  | { kind: "lazy-import"; wrapperCallee: string; specifier: string; import: string }
  // A component passed as an argument to a call rather than rendered as JSX.
  // Two kinds of call produce it: a factory whose product is its own
  // component (`const Dropdown = makeControl(DropdownBase, …)`), owned by
  // the declaration holding the call result, and a hook called in a function
  // body (`useModal(Modal)`), owned by the enclosing component. One
  // occurrence at the argument identifier's own position. `callee` is the
  // identifier of the call the component is handed to and `index` the
  // argument position in that call; a wrapper call between the two follows
  // as a `hoc-wrapper` hop; `specifier` + `import` name the argument's own
  // import exactly as `hoc-wrapper` names its wrapped argument (same
  // helper), and are absent when it has none. Pass-through wrappers
  // (`memo(Foo)`, `connect()(Foo)`, `styled(Foo)`) never emit this kind: a
  // render of the wrapper credits the argument through a `hoc-wrapper` hop.
  | { kind: "passed-as-argument"; callee: string; index: number; specifier?: string; import?: string }
  // JSX element constructed at module scope (`const slot = <X />`) and
  // propagated into a function component via prop forwarding (the binding
  // is referenced inside a function body, which then typically passes it as
  // a prop into another component's render tree).
  //
  // Attribution is "Consumer only": the function that lexically reads the
  // binding, not the function that ultimately renders it. `bindingName` is
  // the const's symbol; `constructionSite` preserves the module-scope source
  // position so consumers can distinguish construction from read sites.
  | {
      kind: "prop-forward";
      bindingName: string;
      constructionSite: { file: string; line: number; column: number };
    }
  // JSX rendered through a non-component-shaped function (data factory or
  // custom hook whose return type contains JSX nested inside Object/Array,
  // not directly). One hop per `via.helper-call` entry, outermost-first;
  // `callee` is the helper symbol, `calleeFile` the file it's declared in.
  // Owner attribution fans out per component-shaped caller.
  | {
      kind: "helper-call";
      callee: string;
      calleeFile: string;
    };
