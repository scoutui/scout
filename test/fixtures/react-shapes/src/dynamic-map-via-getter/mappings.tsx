import { Foo, Bar } from "./components.tsx";

const MAP = { foo: Foo, bar: Bar };

export function getMapped(k: keyof typeof MAP) {
  return MAP[k];
}
