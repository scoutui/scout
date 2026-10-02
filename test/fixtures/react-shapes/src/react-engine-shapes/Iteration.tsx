import { Children, memo } from "react";
import { Button, TextInput, items } from "@example/react-ds";

// A hook-return leaf.
function useModals() {
  return { modals: <Button /> };
}
export function HookLeaf() {
  const { modals } = useModals();
  return modals;
}

// A map-bodied component rendered directly.
export const DirectList = ({ rows }: any) => rows.map((r: string) => <Button key={r} />);

// The same shape through memo.
export const MemoList = memo(({ rows }: any) => rows.map((r: string) => <TextInput key={r} />));

// A map-bodied component reached through a dynamic member lookup.
const MAP: Record<string, any> = { list: DirectList };
export function ViaMap({ k }: any) {
  const C = MAP[k];
  return <C rows={[]} />;
}

// A map-bodied component reached through a ternary alias.
const Alt = () => <Button />;
export function ViaTernary({ c }: any) {
  const C = c ? DirectList : Alt;
  return <C rows={[]} />;
}

// A Children.map-bodied wrapper. Rendered as a tag, so it is a
// component row and owns the inner Button occurrence directly. Unlike
// DirectList above (also .map()-bodied), this one iterates
// `children` rather than a prop array. Asserted at parser level in
// engine-shapes-iteration.test.ts.
export const ChildrenWrapper = ({ children }: any) =>
  Children.map(children, (child: any) => <Button>{child}</Button>);

// A .map over an array imported from an external package.
// Same as ChildrenWrapper: rendered as a tag, so it is a component row and
// owns the inner TextInput occurrence directly. Differs
// from DirectList in the same way — the iterable is a package-imported array,
// not a prop. Asserted in engine-shapes-iteration.test.ts.
export const ExternalArrayList = () => items.map((i: string) => <TextInput key={i} />);
