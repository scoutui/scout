// `moduleResolution: nodenext` requires the emitted `.js` extension on a
// relative specifier; the file on disk is `Leaf.tsx`.
import { Leaf } from "./Leaf.js";

export const A = () => <Leaf />;
