import { Leaf } from "./Leaf";

// `buildRows` is never called from any component — it's a true orphan helper.
export const buildRows = (): JSX.Element[] => [<Leaf />];
