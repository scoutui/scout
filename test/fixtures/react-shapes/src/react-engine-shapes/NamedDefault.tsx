import { Card } from "@example/react-ds";

// A named local re-exported as the default. Same
// default-export position as AnonDefault.tsx's anonymous arrow, different
// declaration form: the `<Card/>` it renders is owned by `NamedView`.
const NamedView = () => <Card />;
export { NamedView as default };
