import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles.css';
import App from './App';
import { useStore } from './state/store';
import { roomFromHash, startSimulations } from './state/sim';

async function boot() {
  const shared = await roomFromHash();
  if (shared) {
    useStore.getState().loadRoom(shared);
    useStore.setState({ onboarded: true });
    useStore.getState().toast(`Opened shared room “${shared.name}”`);
  }
  startSimulations();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
