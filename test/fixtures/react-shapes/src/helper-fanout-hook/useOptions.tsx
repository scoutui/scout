import { Cta } from "./Cta";

type Option = { id: number; cta: JSX.Element };

export const useOptions = (): Option[] => [
  { id: 1, cta: <Cta /> },
];
