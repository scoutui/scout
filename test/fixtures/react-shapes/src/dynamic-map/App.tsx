import { Button, TextInput, Card } from "@example/react-ds";

const COMPONENT_MAP = {
  button: Button,
  input: TextInput,
  card: Card,
};

export function App({ type }: { type: keyof typeof COMPONENT_MAP }) {
  const Comp = COMPONENT_MAP[type];
  return <Comp />;
}
