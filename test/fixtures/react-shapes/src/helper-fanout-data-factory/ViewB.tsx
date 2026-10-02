import { getRows } from "./config";

export const ViewB = () => {
  const rows = getRows();
  return <div>{rows.map((r, i) => <div key={i}>{r.cta}</div>)}</div>;
};
