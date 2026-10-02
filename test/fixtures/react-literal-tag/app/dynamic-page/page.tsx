import { WebButton } from "@example/web-button/dist/react.js";

// `variant` reads a local const, so the occurrence records it as a
// reference to `variant`. `disabled={true}` is a literal, so it's recorded
// as written, with the value `true`.
export default function DynamicPage() {
  const variant = "primary" as const;
  return <WebButton variant={variant} disabled={true}>Submit</WebButton>;
}
