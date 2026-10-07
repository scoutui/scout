---
"@scoutui/cli": patch
---

A scan no longer stops with "Unhandled InferredType kind: undefined" when code reads a member every object inherits, such as `constructor` or `propertyIsEnumerable`, from an object literal. Scout now treats that member like any other the object doesn't have.
