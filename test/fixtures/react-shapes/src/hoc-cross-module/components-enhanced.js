import { Foo, Bar } from "./components.tsx";

const connect = (a, b) => (c) => c;
const flow = (...fns) => (c) => fns.reduce((acc, fn) => fn(acc), c);
const withI18nStrings = (ns) => (c) => c;

export const FooEnhanced = flow(connect(null, {}), withI18nStrings("ns"))(Foo);
export const BarEnhanced = connect(null, {})(Bar);
