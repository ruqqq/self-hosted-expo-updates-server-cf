import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html } from './htm.js';
import { isAuthenticated } from './api.js';

// Import pages
import { LoginPage } from './pages/login.js';
import { HomePage } from './pages/home.js';
import { NewAppPage } from './pages/new-app.js';
import { AppDetailPage } from './pages/app-detail.js';

// Import components
import { Layout } from './components/layout.js';

/**
 * Simple hash-based router
 */
function useRouter() {
  const [route, setRoute] = useState(window.location.hash || '#/');

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash || '#/');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Parse route
  const path = route.replace('#', '') || '/';
  const parts = path.split('/').filter(Boolean);

  return { path, parts, navigate: (to) => { window.location.hash = to; } };
}

/**
 * Main App component
 */
function App() {
  const { path, parts, navigate } = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // Check auth on mount
  useEffect(() => {
    if (!isAuthenticated() && path !== '/login') {
      navigate('#/login');
    }
    setAuthChecked(true);
  }, []);

  // Don't render until auth is checked
  if (!authChecked) {
    return html`<main class="container"><p aria-busy="true">Loading...</p></main>`;
  }

  // Route to pages
  let content;

  if (path === '/login') {
    content = html`<${LoginPage} navigate=${navigate} />`;
  } else if (!isAuthenticated()) {
    // Redirect to login if not authenticated
    navigate('#/login');
    return null;
  } else if (path === '/' || path === '/home') {
    content = html`<${HomePage} navigate=${navigate} />`;
  } else if (path === '/new') {
    content = html`<${NewAppPage} navigate=${navigate} />`;
  } else if (parts[0] === 'app' && parts[1]) {
    const appId = decodeURIComponent(parts[1]);
    content = html`<${AppDetailPage} appId=${appId} navigate=${navigate} />`;
  } else {
    content = html`
      <article>
        <h2>Page Not Found</h2>
        <p>The page you're looking for doesn't exist.</p>
        <a href="#/" role="button">Go Home</a>
      </article>
    `;
  }

  // Wrap authenticated pages with layout
  if (path !== '/login') {
    content = html`<${Layout} navigate=${navigate}>${content}</${Layout}>`;
  }

  return content;
}

// Mount the app
render(html`<${App} />`, document.getElementById('app'));
