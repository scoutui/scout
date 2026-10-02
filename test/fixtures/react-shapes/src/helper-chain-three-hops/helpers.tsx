import { Inner } from "./Inner";

export const helperC = (): JSX.Element[] => [<Inner />];
export const helperB = (): JSX.Element[] => helperC();
export const helperA = (): JSX.Element[] => helperB();
