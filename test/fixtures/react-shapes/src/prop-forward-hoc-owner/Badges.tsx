import React, { memo } from "react";
import { Button, Card } from "@example/react-ds";

const action = <Button />;
const frame = <Card />;

// Each element renders inside a component declared through a wrapper call.
export const MemoBadge = memo(() => <span>{action}</span>);
export const RefBadge = React.forwardRef(() => <span>{frame}</span>);
