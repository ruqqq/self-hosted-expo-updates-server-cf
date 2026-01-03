import { html } from '../htm.js';
import { logout } from '../api.js';

/**
 * Layout wrapper component with header navigation
 */
export function Layout({ children, navigate }) {
  const handleLogout = () => {
    logout();
  };

  return html`
    <header class="container">
      <nav>
        <ul>
          <li><a href="#/" class="contrast"><strong>Expo Updates</strong></a></li>
        </ul>
        <ul>
          <li><a href="#/">Apps</a></li>
          <li><a href="#/new">New App</a></li>
          <li><a href="#" onClick=${handleLogout}>Logout</a></li>
        </ul>
      </nav>
    </header>
    <main class="container">
      ${children}
    </main>
    <footer class="container">
      <small>
        <a href="https://github.com/ruqqq/self-hosted-expo-updates-server" target="_blank">
          Self-Hosted Expo Updates Server
        </a>
      </small>
    </footer>
  `;
}
