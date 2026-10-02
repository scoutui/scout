import MemoisedDefault from "./Wrappers";
import AnonDefault from "./AnonDefault";
import NamedDefault from "./NamedDefault";
import { FactoryButton, Conditional, Item, NsForwarded, NsMemo, BoundJsx } from "./Wrappers";
import {
  HookLeaf,
  DirectList,
  MemoList,
  ViaMap,
  ViaTernary,
  ChildrenWrapper,
  ExternalArrayList,
} from "./Iteration";
import { CrossFileNamespace, SameFileNamespace } from "./NamespaceDefault";
import { Styled } from "./Styled";
import { ImportValuedMap, PlainBodiedMap, PlainTernary } from "./MapControls";
import { ExternalCompound, LocalCompound } from "./Compound";
import { HookPage } from "./HookSeeding";

export function App() {
  return (
    <>
      <BoundJsx />
      <FactoryButton />
      <Conditional />
      <Item />
      <NsForwarded />
      <NsMemo />
      <MemoisedDefault />
      <AnonDefault />
      <NamedDefault />
      <HookLeaf />
      <DirectList rows={[]} />
      <MemoList rows={[]} />
      <ViaMap k="list" />
      <ViaTernary c />
      <ChildrenWrapper />
      <ExternalArrayList />
      <CrossFileNamespace />
      <SameFileNamespace />
      <Styled />
      <ImportValuedMap t="button" />
      <PlainBodiedMap k="leafy" />
      <PlainTernary c />
      <ExternalCompound />
      <LocalCompound />
      <HookPage />
    </>
  );
}
