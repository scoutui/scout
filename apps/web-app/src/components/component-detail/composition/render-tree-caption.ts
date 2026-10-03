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

/** A run of caption text. `count` and `name` mark the numbers and the focus's
 *  name, which the header sets apart from the words around them. */
export type CaptionPart = { text: string; kind: "text" | "count" | "name" };

/** One sentence per side: what renders the focus, then what it renders. */
export type RenderTreeCaption = { up: CaptionPart[]; down: CaptionPart[] };

const text = (s: string): CaptionPart => ({ text: s, kind: "text" });
const count = (n: number): CaptionPart => ({ text: n.toLocaleString(), kind: "count" });

/** One sentence per side, in the order the canvas draws them: the direct
 *  count, then the total, which is dropped when it equals the direct count. */
export function renderTreeCaption(c: RenderTreeCounts): RenderTreeCaption {
  const name: CaptionPart = { text: c.focusName, kind: "name" };
  const components = (n: number) => (n === 1 ? " component" : " components");
  const rendersDirectly = [
    count(c.directParents),
    text(`${components(c.directParents)} ${c.directParents === 1 ? "renders" : "render"} `),
    name,
    text(" directly"),
  ];
  const up =
    c.directParents === 0
      ? [text("Nothing in this repo renders "), name, text(".")]
      : c.dependents === c.directParents
        ? [...rendersDirectly, text(".")]
        : [...rendersDirectly, text("; "), count(c.dependents), text(" depend on it in total.")];
  const down =
    c.directChildren === 0
      ? [name, text(" renders no other components in this repo.")]
      : c.rendered === c.directChildren
        ? [name, text(" renders "), count(c.directChildren), text(`${components(c.directChildren)} directly.`)]
        : [
            name,
            text(" renders "),
            count(c.directChildren),
            text(`${components(c.directChildren)} directly; `),
            count(c.rendered),
            text(" in total."),
          ];
  return { up, down };
}
