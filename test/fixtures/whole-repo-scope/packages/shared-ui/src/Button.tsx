interface ButtonProps {
  label: string;
}

export function Button({ label }: ButtonProps) {
  return <button type="button">{label}</button>;
}
