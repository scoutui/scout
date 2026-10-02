import { Button, Card, TextInput } from "@example/react-ds";

// Components nested inside components.
export function Panel() {
  return (
    <Card>
      <Button>
        <TextInput />
      </Button>
      <TextInput />
    </Card>
  );
}
