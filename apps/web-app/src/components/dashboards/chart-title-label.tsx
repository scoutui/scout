/** A label in a chart's title. A line breaks between words, and inside a name, or after a scoped package's `/`,
 *  only when the name alone is wider than the line. */
export function ChartTitleLabel({ text }: { text: string }) {
  let offset = 0;
  return text.split(/(\s+)/).map((part) => {
    const key = offset;
    offset += part.length;
    if (part.trim() === "") return part;
    const scoped = /^(@[^/]+\/)(.+)$/.exec(part);
    return scoped ? (
      <span key={key} className="inline-block">
        {scoped[1]}
        <wbr />
        <span className="inline-block">{scoped[2]}</span>
      </span>
    ) : (
      <span key={key} className="inline-block">
        {part}
      </span>
    );
  });
}
