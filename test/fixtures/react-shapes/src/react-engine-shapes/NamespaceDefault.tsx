import { Root, Leaf } from "@example/react-ds";
import { NS as CrossFileNS } from "./ns";

// A cross-file namespace member. Resolves to Root today.
export function CrossFileNamespace() {
  return <CrossFileNS.Root />;
}

// The SAME shape declared in this file. Resolves through the
// walker's static-MemberOf arm; the semantic gate asserts `Leaf`.
//
// This renders `.Leaf` rather than `.Root` on purpose, and it is load-bearing.
// `Leaf` is rendered nowhere else in this fixture, so its PRESENCE in the
// artefact is caused by the static-MemberOf arm and nothing else — which is
// what lets the semantic test assert it. If this rendered `.Root`, `Root`
// would still arrive via the cross-file namespace above and the assertion
// would be vacuous.
export const LocalNS = { Root, Leaf };
export function SameFileNamespace() {
  return <LocalNS.Leaf />;
}
