import React from 'react';
function withErrorBoundary(name) {
  return (Child) => (props) => <div><Child {...props} /></div>;
}
export { withErrorBoundary };
