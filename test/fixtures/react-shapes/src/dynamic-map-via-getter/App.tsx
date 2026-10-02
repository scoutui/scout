import { getMapped } from "./mappings.tsx";

export function App({ k }: { k: "foo" | "bar" }) {
  const C = getMapped(k);
  return <C />;
}
