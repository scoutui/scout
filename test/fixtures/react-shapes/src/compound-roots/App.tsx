import { Tabs } from "@example/react-ds";

export function App() {
  return (
    <Tabs.Root>
      <Tabs.Trigger value="a">A</Tabs.Trigger>
    </Tabs.Root>
  );
}

// Intentionally no import for Disclosure — an unbound compound root is observed
// as an unresolved occurrence instead of being dropped.
export function Sidebar() {
  return (
    <Disclosure.Button>Toggle</Disclosure.Button>
  );
}
