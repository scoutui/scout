import { Card } from "@example/react-ds";

// An object literal holds only the members it writes, never one every object
// inherits, such as `constructor`.
const theme = { tone: "warm" };
const Alias = theme.constructor;
const read = () => theme.toString;
const Read = read();
const PARTS = { constructor: Card };

export const hasOwn = () => theme.hasOwnProperty;

export function Picker() {
  return (
    <>
      <Alias />
      <Read />
      <PARTS.constructor />
    </>
  );
}
