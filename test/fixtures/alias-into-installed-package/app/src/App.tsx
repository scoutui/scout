import { Button as AtDsButton } from "@ds";
import { Button as DsxButton } from "dsx";
import { Button as AtDsUiButton } from "@ds/ui";
import { Button as SharedButton } from "@shared";

export function App() {
  return (
    <>
      <AtDsButton />
      <DsxButton />
      <AtDsUiButton />
      <SharedButton />
    </>
  );
}
