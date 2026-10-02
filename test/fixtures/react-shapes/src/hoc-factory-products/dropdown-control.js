import { Dropdown as DropdownBase } from '@example/design-system';
import { makeControl } from './make-control.jsx';
const Dropdown = makeControl(DropdownBase, (p) => ({ value: p.name }));
export { Dropdown };
