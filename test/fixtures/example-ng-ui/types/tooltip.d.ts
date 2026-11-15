import * as i0 from '@angular/core';

/** An attribute directive whose selector attribute is also its main input, as Material's `matTooltip` is. */
declare class ExTooltip {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExTooltip, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExTooltip, "[exTooltip]", never, { "message": { "alias": "exTooltip"; "required": false; }; "position": { "alias": "exTooltipPosition"; "required": false; }; }, {}, never, never, true, never>;
}

/** Matches a bare `<form>`, as `NgForm` does: only `<form exForm>` writes it. */
declare class ExForm {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExForm, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExForm, "form:not([exNoForm]),[exForm]", never, {}, {}, never, never, true, never>;
}

/** An internal helper the public module brings along, exported only under a private `ɵ` name. */
declare class ExTooltipPatch {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExTooltipPatch, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExTooltipPatch, "[exTooltip]", never, {}, {}, never, never, true, never>;
}

declare class ExTooltipModule {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExTooltipModule, never>;
    static ɵmod: i0.ɵɵNgModuleDeclaration<ExTooltipModule, never, [typeof ExTooltip, typeof ExTooltipPatch], [typeof ExTooltip, typeof ExTooltipPatch]>;
}

export { ExForm, ExTooltip, ExTooltipModule, ExTooltipPatch as ɵExTooltipPatch };
