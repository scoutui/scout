import type { FC } from "react";
import ButtonImport from "@example/design-system";

const Button = ("default" in ButtonImport ? ButtonImport.default : ButtonImport) as unknown as FC;

export function Interop() {
  return <Button />;
}
