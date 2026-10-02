import React from 'react';
import { Spinner } from 'ds-icons';
export const withLoading = (C) => (props) => (props.loading ? <Spinner /> : <C {...props} />);
