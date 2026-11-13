import * as i0 from '@angular/core';

/**
 * `ExButtonBase` carries the shared `color`/`disabled` inputs as a `ɵdir`
 * (never a component of its own); `ExButton` declares no inputs itself but
 * `extends` it, so its reported inputs have to come from the base class.
 * Models `@angular/material`'s `MatButton extends MatButtonBase` shape.
 */
declare class ExButtonBase {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExButtonBase, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExButtonBase, never, never, { "color": { "alias": "color"; "required": false; }; "disabled": { "alias": "disabled"; "required": false; }; }, {}, never, never, true, never>;
}

/**
 * Modelled on Angular's own partially-compiled output (see
 * `@angular/material`'s `types/button.d.ts`): a component with an attribute
 * selector, declared in a chunk file the root entry only `import`s from
 * (see `types/index.d.ts`'s plain `export`).
 */
declare class ExButton extends ExButtonBase {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExButton, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExButton, "button[ex-button], a[ex-button]", never, {}, {}, never, never, true, never>;
}

export { ExButton };
