import { memo } from "react";
import { Button, TextInput } from "@example/react-ds";

const connect = <P,>() => (c: P) => c;
const MemoButton = memo(Button);
const ConnectedInput = connect()(TextInput);
const MAP = { memo: MemoButton, conn: ConnectedInput };

export function App() {
  const Comp = MAP.memo;
  return (
    <>
      <MemoButton />
      <ConnectedInput />
      <Comp />
    </>
  );
}
