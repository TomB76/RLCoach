import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { AppDataProvider } from './hooks/useAppData.jsx';
import './styles.css';
import './styles.views.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <AppDataProvider>
        <App />
      </AppDataProvider>
    </ToastProvider>
  </StrictMode>,
);
