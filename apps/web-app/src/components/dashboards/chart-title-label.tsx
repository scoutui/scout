import { Fragment } from "react";

/** A label in a chart's title. A line breaks between words or after a scoped
 *  package's `/`, and inside a name only when the name alone is wider than the line. */
export function ChartTitleLabel({ text }: { text: string }) {
  let offset = 0;
  return text.split(/(\s+)/).map((part) => {
    const key = offset;
    offset += part.length;
    if (part.trim() === "") return part;
    const scoped = /^(@[^/]+\/)(.+)$/.exec(part);
    return scoped ? (
      <Fragment key={key}>
        {scoped[1]}
        <wbr />
        <span className="inline-block">{scoped[2]}</span>
      </Fragment>
    ) : (
      <span key={key} className="inline-block">
        {part}
      </span>
    );
  });
}
