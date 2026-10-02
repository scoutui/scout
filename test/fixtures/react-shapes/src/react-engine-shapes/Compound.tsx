import { Toast } from "@example/react-ds";

// A NAMED import of a compound object from a package outside the
// graph. `Toast` has no declaration the engine can walk to, so the member
// tag is the only evidence: identity is `Toast.Title` on @example/react-ds,
// never the bare holder `Toast`.
export function ExternalCompound() {
  return <Toast.Title />;
}

// An inline-function member on a local namespace object. The
// member has no declaration of its own, so its identity is `LocalInline.Note`
// on this file, never the holder `LocalInline`.
export const LocalInline = { Note: () => <span /> };
export function LocalCompound() {
  return <LocalInline.Note />;
}
