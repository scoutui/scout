import { getRows } from "./utils";

export const View = () => {
  const els = getRows();
  return <div>{els}</div>;
};
