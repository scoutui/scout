import { Leaf } from "./Leaf";

type Row = { cta: JSX.Element };

export const getRows = (): Row[] => [
  { cta: <Leaf /> },
];
