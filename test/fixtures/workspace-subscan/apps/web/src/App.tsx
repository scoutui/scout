import { Badge, Button, Chip, Forms, Table, useSlot } from "@ws-sub/ui";
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
      <Forms.Field />
    </main>
  );
}
