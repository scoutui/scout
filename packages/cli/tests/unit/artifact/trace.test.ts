import { describe, expect, it } from "vitest";
import { toCreditAndTrace } from "../../../src/artifact/trace.js";

describe("toCreditAndTrace", () => {
  it("credits an argument and keeps the argument's import", () => {
    expect(
      toCreditAndTrace([{ kind: "passed-as-argument", callee: "useModal", index: 0, specifier: "./Modal", import: "Modal" }]),
    ).toEqual({
      credit: { kind: "argument", callee: "useModal", index: 0 },
      trace: [{ kind: "import", specifier: "./Modal", name: "Modal" }],
    });
  });

  it("credits a render through a HOC, with the HOC step before its import", () => {
    expect(toCreditAndTrace([{ kind: "hoc-wrapper", hocCallee: "connect", specifier: "./Foo", import: "Foo" }])).toEqual({
      credit: { kind: "render" },
      trace: [
        { kind: "hoc", callee: "connect" },
        { kind: "import", specifier: "./Foo", name: "Foo" },
      ],
    });
  });

  it("leaves an argument's import to the wrapper hop that names the same import", () => {
    expect(
      toCreditAndTrace([
        { kind: "passed-as-argument", callee: "useModal", index: 0, specifier: "./Modal", import: "Modal" },
        { kind: "hoc-wrapper", hocCallee: "withTheme", specifier: "./Modal", import: "Modal" },
      ]).trace,
    ).toEqual([
      { kind: "hoc", callee: "withTheme" },
      { kind: "import", specifier: "./Modal", name: "Modal" },
    ]);
  });

  it("gives a local component no trace steps", () => {
    expect(toCreditAndTrace([{ kind: "local-component" }])).toEqual({ credit: { kind: "render" }, trace: [] });
  });

  it("takes the credit from a passed-as-argument hop behind a helper call", () => {
    expect(
      toCreditAndTrace([
        { kind: "helper-call", callee: "useRows", calleeFile: "src/rows.ts" },
        { kind: "passed-as-argument", callee: "useModal", index: 1, specifier: "./Modal", import: "Modal" },
      ]),
    ).toEqual({
      credit: { kind: "argument", callee: "useModal", index: 1 },
      trace: [
        { kind: "helper-call", callee: "useRows", calleeFile: "src/rows.ts" },
        { kind: "import", specifier: "./Modal", name: "Modal" },
      ],
    });
  });

  it("records a tag written in another case, and nothing for a lowercase tag", () => {
    expect(toCreditAndTrace([{ kind: "html-tag" }], "X-Card").trace).toEqual([{ kind: "tag", written: "X-Card" }]);
    expect(toCreditAndTrace([{ kind: "html-tag" }], "x-card").trace).toEqual([]);
    expect(toCreditAndTrace([{ kind: "html-tag" }], "my-Élan").trace).toEqual([]);
  });
});
