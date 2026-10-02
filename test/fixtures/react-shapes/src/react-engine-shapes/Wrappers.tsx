import React, { forwardRef, memo } from "react";
import * as R from "react";
import { Button, TextInput, Card, RadioArea } from "@example/react-ds";

// A JSX value bound to a local, then returned.
export function BoundJsx() {
  const el = <Button />;
  return el;
}

// A createComponent-style local factory (forwardRef + memo inside).
function createComponent(render: any) {
  return memo(forwardRef(render));
}
export const FactoryButton = createComponent((props: any, ref: any) => (
  <TextInput {...props} ref={ref} />
));

// A conditional-return component under memo.
export const Conditional = memo(({ x }: any) => {
  if (x) return <Button />;
  return <Card />;
});

// A bare alias declaration.
export const Item = RadioArea;

// A namespace-import forwardRef.
export const NsForwarded = R.forwardRef((props: any, _ref: any) => <Card {...props} />);

// A two-argument namespace-import memo.
const NsMemoView = () => <TextInput />;
export const NsMemo = R.memo(NsMemoView, () => true);

// A default-import React.memo with a comparator, exported as default.
const DefaultView = () => <Button />;
export default React.memo(DefaultView, () => true);
