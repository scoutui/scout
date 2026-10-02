import { Notification } from "./Notification";
import { Page } from "./Page";

// Canonical prop-forward pattern: module-scope const holding JSX,
// then passed as a prop into another component's render tree.
const slot = <Notification />;

export const Consumer = () => <Page slot={slot} />;
