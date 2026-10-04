import { Button, SharedButton } from "@example/shared-ui";

export function App() {
  return (
    <main>
      <SharedButton label="Save" />
      <SharedButton label="Cancel" />
      <Button label="Help" />
    </main>
  );
}
