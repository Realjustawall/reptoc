import './compat.ts';
import '@fontsource-variable/noto-sans-arabic/wght.css';
import '@fontsource-variable/noto-naskh-arabic/wght.css';
import '@fontsource-variable/noto-kufi-arabic/wght.css';
import '@fontsource-variable/markazi-text/wght.css';
import '@fontsource/amiri/arabic-400.css';
import '@fontsource/amiri/arabic-700.css';
import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/tajawal/arabic-400.css';
import '@fontsource/tajawal/arabic-700.css';
import '@fontsource/changa/arabic-400.css';
import '@fontsource/changa/arabic-700.css';
import '@fontsource/lemonada/arabic-400.css';
import '@fontsource/lemonada/arabic-700.css';
import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {migrateBrandStorage} from './utils/migrateBrandStorage.ts';

migrateBrandStorage();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => console.warn("Service worker registration failed:", error));
  });
}

class StartupErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  declare props: React.PropsWithChildren;
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Application startup failed', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="startup-error" role="alert">
          <h1>رپتوک راه‌اندازی نشد</h1>
          <p>لطفاً صفحه را تازه‌سازی کنید. اگر مشکل ادامه داشت، مرورگر خود را به‌روزرسانی کرده و دوباره تلاش کنید.</p>
          <button type="button" onClick={() => window.location.reload()}>تازه‌سازی صفحه</button>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing application root element');

createRoot(rootElement).render(
  <StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </StrictMode>,
);
