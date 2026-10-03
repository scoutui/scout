import type { FC } from "react";
import { Thing } from "./barrel";

const ThingButton = ("default" in Thing ? Thing.default : Thing) as unknown as FC;

export function Through() {
  return <ThingButton />;
}
