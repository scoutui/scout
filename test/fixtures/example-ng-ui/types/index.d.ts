/**
 * The root entry only `import`s `ExButton` from the chunk that declares it,
 * then re-exports it with a plain `export { ExButton };` - no `from` clause.
 * Modelled on `@angular/material`'s `types/button-toggle.d.ts`
 * (`import { MatButtonToggle, ... } from './_button-toggle-chunk.js'; ...
 * export { MatButtonToggle, ... };`): the resolver has to follow the
 * `import` binding into the chunk, the same as it follows a re-export's
 * `from` clause.
 */
import { ExButton } from './_button-chunk.js';

export { ExButton };
