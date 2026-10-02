import { canonicalTagName } from "@scoutui/reference-graph";
import type { Credit, Known, TraceStep } from "@scoutui/scan-format";
import type { OccurrenceVia } from "@scoutui/reference-graph";

type ImportStep = Extract<TraceStep, { kind: "import" }>;

/** The import a hop was read through; a hop naming a value that is not imported has none. */
function importOf(hop: OccurrenceVia | undefined): ImportStep | undefined {
  if (hop === undefined || !("specifier" in hop) || hop.specifier === undefined || hop.import === undefined) return undefined;
  return { kind: "import", specifier: hop.specifier, name: hop.import };
}

/** The step a hop contributes ahead of its own import, if any. */
function hopStep(hop: OccurrenceVia): Known<TraceStep> | undefined {
  switch (hop.kind) {
    case "hoc-wrapper":
      return { kind: "hoc", callee: hop.hocCallee };
    case "lazy-import":
      return { kind: "lazy", callee: hop.wrapperCallee };
    case "dynamic-map":
      return { kind: "dynamic-map", mapName: hop.mapName, mapLoc: hop.mapLoc };
    case "helper-call":
      return { kind: "helper-call", callee: hop.callee, calleeFile: hop.calleeFile };
    case "prop-forward":
      return { kind: "prop-forward", bindingName: hop.bindingName, constructionSite: hop.constructionSite };
    default:
      return undefined;
  }
}

/**
 * Maps an engine via chain (outermost-first) to the occurrence's credit and trace.
 * The credit is `argument` when any hop passes the component as a call argument
 * (the outermost such hop), else `render`. A `tag` step records an authored tag
 * that differs from its canonical name (`canonicalTagName`).
 */
export function toCreditAndTrace(
  viaChain: readonly OccurrenceVia[],
  authoredTag?: string,
): { credit: Known<Credit>; trace: Known<TraceStep>[] } {
  const argument = viaChain.find((hop) => hop.kind === "passed-as-argument");
  const credit: Known<Credit> =
    argument?.kind === "passed-as-argument"
      ? { kind: "argument", callee: argument.callee, index: argument.index }
      : { kind: "render" };

  const trace: Known<TraceStep>[] = [];
  for (const [i, hop] of viaChain.entries()) {
    const step = hopStep(hop);
    if (step !== undefined) trace.push(step);
    const own = importOf(hop);
    if (own === undefined) continue;
    // A wrapping hop's import is left to the next hop when that hop names the same import.
    if (hop.kind === "hoc-wrapper" || hop.kind === "lazy-import" || hop.kind === "passed-as-argument") {
      const next = importOf(viaChain[i + 1]);
      if (next?.specifier === own.specifier && next.name === own.name) continue;
    }
    trace.push(own);
  }
  if (authoredTag !== undefined && authoredTag !== canonicalTagName(authoredTag)) {
    trace.push({ kind: "tag", written: authoredTag });
  }
  return { credit, trace };
}
