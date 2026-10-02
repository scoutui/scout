import React from 'react';
import { withErrorBoundary } from './with-error-boundary.jsx';
const SignupForm = ({ title }) => <form>{title}</form>;
export default withErrorBoundary('SignupForm')(SignupForm);
