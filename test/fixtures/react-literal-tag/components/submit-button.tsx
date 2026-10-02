import { WebButton } from "@example/web-button/dist/react.js";

export function SubmitButton(props: { variant?: "primary" | "secondary" }) {
  return <WebButton variant={props.variant ?? "primary"}>Submit</WebButton>;
}
