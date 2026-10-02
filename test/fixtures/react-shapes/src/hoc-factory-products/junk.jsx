import React from 'react';
const br = <br key="br" />;
function renderIcon() { return <i>icon</i>; }
export class ApiClient { fetch() { return 1; } }
export const Junk = () => <div>{br}{renderIcon()}</div>;
