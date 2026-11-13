import * as i0 from '@angular/core';

/** A component the package also hands out inside a `const` array of imports. */
declare class ExampleBadge {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExampleBadge, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExampleBadge, "ex-badge", never, {}, {}, never, never, true, never>;
}

/**
 * Not a class: a list of imports, the way some libraries ship a component with
 * its helpers. The scan can't read what it holds from the typings, so a
 * component that lists it has a scope it can only partly read.
 */
declare const ExampleImports: readonly [typeof ExampleBadge];

export { ExampleBadge, ExampleImports };
