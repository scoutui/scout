import { Button, Card } from "../ui";
import { Badge } from "../ui/rewrap";
import { Tooltip } from "../ui/star";

export function ThroughBarrels() {
  return (
    <Card>
      <Badge />
      <Tooltip />
      <Button>Save</Button>
    </Card>
  );
}
