import type { ReactElement } from "react";

export const Page = ({ slot }: { slot: ReactElement }) => <div>{slot}</div>;
