import { Button, Card, TextInput } from "@example/react-ds";

// CONTROL for Iteration.tsx's dynamic member lookup — an import-valued map.
// Both entries resolve WITH dynamic-map provenance, so a regression here
// means the dynamic-map arm itself broke, not the map-bodied case.
const IMPORT_MAP: Record<string, any> = { button: Button, card: Card };
export function ImportValuedMap({ t }: any) {
  const C = IMPORT_MAP[t];
  return <C />;
}

// CONTROL for the same lookup — a local PLAIN-bodied component through the
// same dispatch, beside the map-bodied one in Iteration.tsx.
const Leafy = () => <TextInput />;
const LOCAL_MAP: Record<string, any> = { leafy: Leafy };
export function PlainBodiedMap({ k }: any) {
  const C = LOCAL_MAP[k];
  return <C />;
}

// CONTROL for the ternary alias — a ternary over two PLAIN-bodied locals,
// beside the map-bodied branch in Iteration.tsx.
const PlainA = () => <Button />;
const PlainB = () => <Card />;
export function PlainTernary({ c }: any) {
  const C = c ? PlainA : PlainB;
  return <C />;
}
