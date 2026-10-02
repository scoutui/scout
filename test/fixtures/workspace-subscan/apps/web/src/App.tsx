import { Badge, Button, Chip, Table, useSlot } from "@ws-sub/ui";
import { Card } from "./card";

const { Cell } = Table;

export function App() {
  useSlot(Badge);
  return (
    <main>
      <Button size="lg" />
      <Card title="hi" />
      <Chip />
      <Table.Row />
      <Cell />
    </main>
  );
}
