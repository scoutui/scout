import React from 'react';
import { withLoading } from './with-loading.jsx';
const FooView = () => <section>foo</section>;
const BarView = () => <section>bar</section>;
export const Foo = withLoading(FooView);
export const Bar = withLoading(BarView);
