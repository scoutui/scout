import { Button, Card } from "../ui";
import { UiKit } from "../ui/ns";
import { UiParts } from "../ui/ns-star";
import { Badge } from "../ui/rewrap";
import { Spinner, Tooltip } from "../ui/star";

export function ThroughBarrels() {
  return (
    <Card>
      <Badge />
      <Tooltip />
      <Button>Save</Button>
      <UiKit.Avatar />
      <UiParts.Banner />
      <Spinner />
    </Card>
  );
}
