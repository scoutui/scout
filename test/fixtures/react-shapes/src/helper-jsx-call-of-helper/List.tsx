import { Item } from "./Item";

// `List` maps its items to elements, so it's a component, not a helper.
// `Page` renders it as <List items={…}/> in JSX, and `List` renders `Item`
// directly: `Item` is owned by `List` with no helper-call hop, and `List`
// is owned by `Page`.
export const List = ({ items }: { items: { id: number }[] }) =>
  items.map((it) => <Item key={it.id} />);
