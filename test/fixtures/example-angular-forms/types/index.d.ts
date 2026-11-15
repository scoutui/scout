import * as i0 from '@angular/core';

/** Takes `ngModel` as its input, so it owns the name and counts wherever `ngModel` is written. */
declare class NgModel {
    static ɵfac: i0.ɵɵFactoryDeclaration<NgModel, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<NgModel, "[ngModel]:not([formControlName]):not([formControl])", ["ngModel"], { "model": { "alias": "ngModel"; "required": false; }; }, { "update": "ngModelChange"; }, never, never, true, never>;
}

/** Rides along on `ngModel` with no inputs of its own, as Angular's does: it never counts. */
declare class NgControlStatus {
    static ɵfac: i0.ɵɵFactoryDeclaration<NgControlStatus, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<NgControlStatus, "[formControlName],[ngModel],[formControl]", never, {}, {}, never, never, false, never>;
}

declare class FormsModule {
    static ɵfac: i0.ɵɵFactoryDeclaration<FormsModule, never>;
    static ɵmod: i0.ɵɵNgModuleDeclaration<FormsModule, never, [typeof NgModel, typeof NgControlStatus], [typeof NgModel, typeof NgControlStatus]>;
}

export { FormsModule, NgControlStatus, NgModel };
