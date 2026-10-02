import { memo } from "react";

// `memo` over a component that renders nothing: the wrapped component is
// still what a factory receives.
const Quiet = () => null;
const Held = memo(Quiet);
function createSlot(C: any) {
  return () => <C />;
}
export const Slot = createSlot(Held);

export function SlotPage() {
  return (
    <>
      <Slot />
      <Held />
    </>
  );
}
