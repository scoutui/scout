import { Leaf } from "./Leaf";

// `build` is a helper called both directly by ViewA AND indirectly via wrap.
export const build = (): JSX.Element[] => [<Leaf />];
