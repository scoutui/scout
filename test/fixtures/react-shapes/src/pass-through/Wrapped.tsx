import { Card } from "@example/react-ds";

// A wrapper that hands back the component it wraps through local aliases
// rather than returning its parameter directly.
const withAlias = (C: any) => {
  const First = C;
  const Second = First;
  return Second;
};

const AliasCard = withAlias(Card);

export function Wrapped() {
  return <AliasCard />;
}
