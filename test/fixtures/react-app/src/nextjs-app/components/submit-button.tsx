import * as React from "react";
import { WebButton } from "@example/web-button/dist/react.js";

export function SubmitButton(props: { variant?: string }) {
  return <WebButton variant={props.variant ?? "primary"}>Submit</WebButton>;
}
