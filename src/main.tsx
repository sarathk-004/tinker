import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fonts ship with the app (no outside font service): the page loads faster, works offline, and pictures exported from the canvas can embed them.
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
