import type { ComponentDetail } from "@scoutui/web-shared";
import { type SourceRef, sourceFileUrl } from "@/lib/source-link";
import { declaredFacts } from "./usage-column";
import { LINK } from "./usage-toolbar";

/** The Usage tab of a component the scan found no calls to: a link to its definition and the props it declares. */
export function NoCalls({ detail, source }: { detail: ComponentDetail; source: SourceRef | null }) {
  const at = detail.definedAt;
  const href = at && source ? sourceFileUrl(source.remote, source.commit, at.filePath, at.line) : null;
  return (
    <div className="panel overflow-clip">
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        <p className="text-foreground">
          This scan found no calls to <span className="font-mono">{detail.displayName}</span> in <span className="font-mono">{detail.repoId}</span>.
        </p>
        {href ? (
          <p className="mt-1.5">
            <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
              Open the definition
            </a>
          </p>
        ) : null}
      </div>
      {detail.props.length > 0 ? (
        <section aria-labelledby="usage-declared" className="border-t px-4 py-3">
          <h2 id="usage-declared" className="text-label mb-2 flex items-baseline gap-1.5 text-muted-foreground">
            Props <span className="tabular-nums">{detail.props.length.toLocaleString()}</span>
          </h2>
          <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {detail.props.map((p) => {
              const facts = p.declared ? declaredFacts(p.declared) : [];
              return (
                <li key={p.name} className="min-w-0 text-xs">
                  <span className="font-mono font-medium">{p.name}</span>
                  {facts.length > 0 ? (
                    <span className="ml-2 text-muted-foreground">
                      {facts.map((fact, i) => (
                        <span key={fact.key}>
                          {i > 0 ? (
                            <>
                              {" "}
                              <span aria-hidden>·</span>{" "}
                            </>
                          ) : null}
                          {fact}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
