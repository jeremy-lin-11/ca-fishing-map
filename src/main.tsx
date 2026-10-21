import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './posthog';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Offline support (public/sw.js). Production builds only, so the dev server's hot reload isn't cached.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
