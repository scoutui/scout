import { useOptions } from "./useOptions";

export const Panel = () => {
  const opts = useOptions();
  return <ul>{opts.map((o) => <li key={o.id}>{o.cta}</li>)}</ul>;
};
