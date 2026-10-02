import { build } from "./build";
import { wrap } from "./wrap";

// ViewA calls `build` directly — 1-hop chain.
export const ViewA = () => {
  const els = build();
  return <div>{els}</div>;
};

// ViewB calls `wrap`, which calls `build` — 2-hop chain.
export const ViewB = () => {
  const els = wrap();
  return <div>{els}</div>;
};
