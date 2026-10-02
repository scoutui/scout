import React from 'react';
// An export alias whose name a nested declaration also uses.
export function Gallery() { const Swatch = () => <i />; return <Swatch />; }
const SwatchImpl = () => <b />;
export { SwatchImpl as Swatch };
