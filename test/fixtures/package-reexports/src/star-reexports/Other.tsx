import AllDefault from "@example/all";
import { Button as OwnButton } from "@example/own";
import { Card as KitCard, Icons } from "@example/kit";

export function Other() {
  return (
    <div>
      <AllDefault />
      <OwnButton />
      <KitCard />
      <Icons.Star />
    </div>
  );
}
