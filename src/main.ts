import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app, exercises } from './state.svelte';
import { createEngine } from './engines';

document.documentElement.dataset.theme = app.settings.theme;
mount(App, { target: document.getElementById('app')! });
app.start();

// Hosted build: register the service worker so dbify works offline and can be installed.
if (import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Handy for debugging from the browser console, and used by the automated tests.
(window as any).dbify = { app, createEngine, exercises };
