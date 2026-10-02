import { A } from "./A";
import { B } from "./B";
import { Icon } from "./Icon";

const icon = <Icon />;
export const C = () => (
  <>
    <A x={icon} />
    <B y={icon} />
  </>
);
