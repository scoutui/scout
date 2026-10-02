import React from 'react';
// A nested declaration shares the name of a later top-level component.
export function Mosaic() { const Tessera = ({ inner }) => <i>{inner}</i>; return <Tessera inner="x" />; }
export const Tessera = ({ outer }) => <b>{outer}</b>;
