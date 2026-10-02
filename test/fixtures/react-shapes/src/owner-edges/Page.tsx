import { memo } from "react";
import { Button, Card } from "@example/owner-edges";

export function Page() {
  return (
    <Card>
      <Button variant="primary">Save</Button>
    </Card>
  );
}

export const Footer = memo(() => <Button variant="ghost">Cancel</Button>);

export default function() {
  return <Button>Anonymous default</Button>;
}
