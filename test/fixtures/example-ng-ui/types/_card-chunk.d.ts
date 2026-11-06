import * as i0 from '@angular/core';

/**
 * `elevation` is a plain input (template name = its property name);
 * `cardTitle` is aliased to the template name `title`; `closed` is an
 * output. Models `@angular/material`'s `MatCard`/`MatButton` shape.
 */
declare class ExCard {
    elevation: number;
    cardTitle: string;
    static ɵfac: i0.ɵɵFactoryDeclaration<ExCard, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExCard, "ex-card", never, { "elevation": { "alias": "elevation"; "required": false; }; "cardTitle": { "alias": "title"; "required": false; }; }, { "closed": "closed"; }, never, ["*"], true, never>;
}

declare class ExCardModule {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExCardModule, never>;
    static ɵmod: i0.ɵɵNgModuleDeclaration<ExCardModule, never, [typeof ExCard], [typeof ExCard]>;
}

export { ExCard, ExCardModule };
