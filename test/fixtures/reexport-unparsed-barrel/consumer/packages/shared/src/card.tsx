export function Card(props: { children?: unknown }) {
  return <section>{props.children as never}</section>;
}
