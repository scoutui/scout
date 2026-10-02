/** Inputs for the canvas header's caption. `directParents`/`directChildren`
 *  are the canvas's "rendered by" and "renders" columns; `dependents` and
 *  `rendered` are the rail's list sizes, passed in so caption and rail agree. */
export type RenderTreeCounts = {
  focusName: string;
  directParents: number;
  /** Everything that renders the focus at any depth, focus excluded. Includes
   *  `directParents`. */
  dependents: number;
  directChildren: number;
  /** Everything the focus renders at any depth, focus excluded. Includes
   *  `directChildren`. */
  rendered: number;
};

const components = (n: number): string =>
  n === 1 ? "1 component" : `${n.toLocaleString()} components`;
const rendersDirectly = (n: number, name: string): string =>
  `${components(n)} ${n === 1 ? "renders" : "render"} ${name} directly`;

/** One sentence per side, in the order the canvas draws them: the direct
 *  count, then the total, which is dropped when it equals the direct count. */
export function renderTreeCaption(c: RenderTreeCounts): string {
  const up =
    c.directParents === 0
      ? `Nothing in this repo renders ${c.focusName}.`
      : c.dependents === c.directParents
        ? `${rendersDirectly(c.directParents, c.focusName)}.`
        : `${rendersDirectly(c.directParents, c.focusName)}; ${c.dependents.toLocaleString()} depend on it in total.`;
  const down =
    c.directChildren === 0
      ? `${c.focusName} renders no other components in this repo.`
      : c.rendered === c.directChildren
        ? `${c.focusName} renders ${components(c.directChildren)} directly.`
        : `${c.focusName} renders ${components(c.directChildren)} directly; ${c.rendered.toLocaleString()} in total.`;
  return `${up} ${down}`;
}
