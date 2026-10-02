import { Banner } from "@example/react-ds";

// An anonymous default-export arrow. The `<Banner/>` it
// renders is owned by `default`, the name the module exports it under.
// NamedDefault.tsx puts a named local in the same default-export
// position, so the two files differ only in how the default is declared.
//
// HookSeeding.tsx renders `Banner` too, so a `Banner` row alone doesn't show
// this shape works: react-shapes.test.ts checks this file's occurrence, at
// its position and with `default` as its owner, in the test for the
// anonymous and the named default export.
export default () => <Banner />;
