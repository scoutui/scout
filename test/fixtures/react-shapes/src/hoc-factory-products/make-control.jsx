import React from 'react';
const makeControl = (Component, mapProps) => (props) => {
  const extra = mapProps ? mapProps(props) : null;
  return <Component {...props} {...extra} />;
};
export { makeControl };
