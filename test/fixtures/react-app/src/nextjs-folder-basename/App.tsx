import { Avatar } from "./components/avatar";
import { Button } from "./components/button";

export function App() {
  return (
    <>
      <Avatar src="/me.png" />
      <Button label="ok" onLabel="On" onClick={save} />
    </>
  );
}

function save() {
  console.log("clicked");
}
