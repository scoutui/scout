import { Foo } from 'pkg';
import { ItemIcon } from './item-icon';

export function ItemPanel({ item }) {
    const id = item.id || item;
    return (
        <div>
            <ItemIcon id={id} />
            <Foo value={id} />
        </div>
    );
}
