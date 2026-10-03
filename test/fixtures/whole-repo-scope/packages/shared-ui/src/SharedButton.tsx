import { Button } from "./Button";

interface SharedButtonProps {
  label: string;
}

export function SharedButton({ label }: SharedButtonProps) {
  return <Button label={label} />;
}
