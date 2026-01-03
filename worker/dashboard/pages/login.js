import { useState } from 'preact/hooks';
import { html } from '../htm.js';
import { login } from '../api.js';

/**
 * Login page component
 */
export function LoginPage({ navigate }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('#/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return html`
    <main class="container">
      <article style="max-width: 400px; margin: 4rem auto;">
        <header>
          <h1 style="margin-bottom: 0;">Expo Updates</h1>
          <p class="secondary">Sign in to manage your updates</p>
        </header>

        <form onSubmit=${handleSubmit}>
          ${error && html`
            <p style="color: var(--pico-del-color);">${error}</p>
          `}

          <label>
            Username
            <input
              type="text"
              name="username"
              value=${username}
              onInput=${(e) => setUsername(e.target.value)}
              required
              autofocus
            />
          </label>

          <label>
            Password
            <input
              type="password"
              name="password"
              value=${password}
              onInput=${(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <button type="submit" aria-busy=${loading} disabled=${loading}>
            ${loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </article>
    </main>
  `;
}
