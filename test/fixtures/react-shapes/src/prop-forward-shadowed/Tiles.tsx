import { Button } from "@example/react-ds";

const icon = <Button />;

// Reads the module-scope element.
export const Toolbar = () => <nav>{icon}</nav>;

// A parameter default rebinds `icon`, so this reads the prop, not the element.
export const Tile = ({ icon = null }) => <div>{icon}</div>;
