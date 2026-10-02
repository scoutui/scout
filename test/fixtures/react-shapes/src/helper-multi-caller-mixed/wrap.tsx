import { build } from "./build";

// `wrap` is another helper — it returns build's value, creating a 2-hop chain.
export const wrap = (): JSX.Element[] => build();
