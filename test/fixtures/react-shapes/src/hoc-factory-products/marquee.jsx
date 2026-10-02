import React from 'react';
// A component exported under another name; the render credits
// MarqueeView, which the alias export leaves out of the roster.
const MarqueeView = () => <div>scrolling</div>;
export const Marquee = MarqueeView;
