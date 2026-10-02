import React, { forwardRef } from 'react';
// A forwardRef-wrapped export; the render credits PennantView, which
// nothing exports and nothing holds.
const PennantView = ({ label }, ref) => <span ref={ref}>{label}</span>;
const PennantBase = PennantView;
export const Pennant = forwardRef(PennantBase);
