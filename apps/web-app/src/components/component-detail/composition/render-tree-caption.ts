/** How many components sit on one side of the focus: one step away, and at
 *  any number of steps. `total` includes `direct`. */
export type SideCounts = { direct: number; total: number };

const components = (n: number) => `${n.toLocaleString()} ${n === 1 ? "component" : "components"}`;

/** The tab's one-line caption: what renders the focus, then what it renders.
 *  A side with nothing on it is left out. */
export function renderTreeCaption(focusName: string, up: SideCounts, down: SideCounts): string {
  if (up.direct === 0 && down.direct === 0) {
    return `Nothing in this repo renders ${focusName}, and ${focusName} renders no other components.`;
  }
  const sentences: string[] = [];
  if (up.direct > 0) {
    sentences.push(
      up.total > up.direct
        ? `Rendered directly by ${components(up.direct)}, and by ${up.total.toLocaleString()} in total.`
        : `Rendered directly by ${components(up.direct)}.`,
    );
  }
  if (down.direct > 0) {
    sentences.push(
      down.total > down.direct
        ? `Renders ${components(down.direct)} directly, and ${down.total.toLocaleString()} in total.`
        : `Renders ${components(down.direct)} directly.`,
    );
  }
  return sentences.join(" ");
}
