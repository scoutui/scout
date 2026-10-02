import React, { forwardRef, memo } from "react";
import { Button, TextInput, Card } from "@example/react-ds";

// 1. forwardRef over an anonymous arrow — identity is the holding declaration.
export const FancyButton = forwardRef((props: any, _ref: any) => <Button {...props} />);

// 2. memo over an imported component — identity folds to the import.
export const MemoInput = memo(TextInput);

// 3. Member-callee form.
export const MemoCard = React.memo(Card);

// 4. Nested built-ins.
export const Nested = memo(forwardRef((props: any, _ref: any) => <TextInput {...props} />));

// 5. memo over a same-file local component, exported as default.
const Plain = () => <div />;
export default memo(Plain);

export function App() {
  return (
    <>
      <FancyButton />
      <MemoInput />
      <MemoCard />
      <Nested />
    </>
  );
}
