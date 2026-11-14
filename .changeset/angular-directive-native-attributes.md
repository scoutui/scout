---
"@scoutui/cli": patch
---

An Angular directive no longer counts just because it takes a native HTML attribute as an input: `RequiredValidator`, `MaxLengthValidator` and the like on `<input required maxlength="20" [(ngModel)]="name">`, or CDK's `Dir` on a plain `dir="rtl"`, ride along on the element the way `NgControlStatus` does.
