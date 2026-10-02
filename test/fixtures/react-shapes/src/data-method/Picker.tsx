// A callback handed to a data method is called, not rendered: `find` returns
// one of the array's entries, never the callback.
const Alpha = () => <b />;
const ALL = [Alpha];

export function Picker() {
  const Shown = ALL.find((c: any) => c.ok);
  return <Shown />;
}
