import { describe, expect, it } from "vitest";
import {
  creditedTerminals,
  matchDenotation,
  renderOutcome,
  type Denotation,
  type Evaluation,
  type Terminal,
} from "../../src/engine/denotation.js";

const t = (denotation: Denotation): Terminal => ({ denotation, identity: null, viaTrail: [] });
const ev = (...ds: Denotation[]): Evaluation => ds.map(t) as unknown as Evaluation;

const ELEMENT: Denotation = { kind: "element" };
const FOREIGN: Denotation = { kind: "foreign" };
const HOST: Denotation = { kind: "host-string", value: "span" };
const CONTEXT: Denotation = { kind: "opaque", semantics: "context" };
const LATE: Denotation = { kind: "late-bound", source: "parameter" };
const DATA: Denotation = { kind: "data", shape: "object" };
const RETURNED_STRING: Denotation = { kind: "data", shape: "string" };
const NOTHING: Denotation = { kind: "indeterminate" };
const CALLABLE: Denotation = { kind: "callable" };

describe("renderOutcome", () => {
  it("credits element, foreign and callable terminals and only those", () => {
    const out = renderOutcome(ev(NOTHING, ELEMENT, HOST, FOREIGN, CALLABLE));
    expect(out.kind).toBe("credit");
    expect(out.kind === "credit" && out.terminals.map((x) => x.denotation.kind)).toEqual([
      "element",
      "foreign",
      "callable",
    ]);
  });

  it("is silent for a host string, and a host string beats a late-bound branch", () => {
    expect(renderOutcome(ev(LATE, HOST))).toEqual({ kind: "silent", because: "host-string" });
  });

  it("is silent for a context object", () => {
    expect(renderOutcome(ev(CONTEXT))).toEqual({ kind: "silent", because: "opaque" });
  });

  it("diagnoses late-bound ahead of unresolved", () => {
    expect(renderOutcome(ev(NOTHING, DATA, LATE))).toEqual({
      kind: "diagnose",
      code: "late-bound-render",
    });
  });

  it("diagnoses data and indeterminate as unresolved-reference", () => {
    expect(renderOutcome(ev(DATA))).toEqual({ kind: "diagnose", code: "unresolved-reference" });
    expect(renderOutcome(ev(NOTHING))).toEqual({ kind: "diagnose", code: "unresolved-reference" });
  });

  it("diagnoses a returned string as unresolved-reference, never silence", () => {
    expect(renderOutcome(ev(RETURNED_STRING))).toEqual({ kind: "diagnose", code: "unresolved-reference" });
  });
});

describe("creditedTerminals", () => {
  it("returns the credited terminals in evaluation order, or none", () => {
    expect(creditedTerminals(ev(FOREIGN, NOTHING, ELEMENT)).map((x) => x.denotation.kind)).toEqual([
      "foreign",
      "element",
    ]);
    expect(creditedTerminals(ev(HOST, LATE))).toEqual([]);
  });
});

describe("matchDenotation", () => {
  it("dispatches on the kind and hands the handler the narrowed denotation", () => {
    const label = (x: Terminal) =>
      matchDenotation(x, {
        element: () => "element",
        foreign: () => "foreign",
        "host-string": (d) => `host:${d.value}`,
        opaque: (d) => `opaque:${d.semantics}`,
        "late-bound": (d) => `late:${d.source}`,
        data: (d) => `data:${d.shape}`,
        indeterminate: () => "nothing",
        callable: () => "callable",
      });
    expect(
      [ELEMENT, FOREIGN, HOST, CONTEXT, LATE, DATA, RETURNED_STRING, NOTHING, CALLABLE].map((d) => label(t(d))),
    ).toEqual([
      "element",
      "foreign",
      "host:span",
      "opaque:context",
      "late:parameter",
      "data:object",
      "data:string",
      "nothing",
      "callable",
    ]);
  });
});
