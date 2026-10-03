
import './frontend/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './frontend/App';
import { captureSignupSource } from './frontend/utils/signupSource';

captureSignupSource();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
