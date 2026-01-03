import { useState } from 'preact/hooks';
import { html } from '../htm.js';
import { createApp } from '../api.js';

/**
 * New App page - create a new app
 */
export function NewAppPage({ navigate }) {
  const [appId, setAppId] = useState('');
  const [appName, setAppName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await createApp(appId, appName || appId);
      navigate(`#/app/${encodeURIComponent(appId)}`);
    } catch (err) {
      setError(err.message || 'Failed to create app');
    } finally {
      setLoading(false);
    }
  };

  return html`
    <article style="max-width: 500px;">
      <header>
        <h2>Create New App</h2>
      </header>

      <form onSubmit=${handleSubmit}>
        ${error && html`
          <p style="color: var(--pico-del-color);">${error}</p>
        `}

        <label>
          App ID (slug)
          <input
            type="text"
            name="appId"
            value=${appId}
            onInput=${(e) => setAppId(e.target.value)}
            placeholder="my-expo-app"
            pattern="[a-z0-9-]+"
            required
            autofocus
          />
          <small>Lowercase letters, numbers, and hyphens only. This will be used in URLs.</small>
        </label>

        <label>
          Display Name (optional)
          <input
            type="text"
            name="appName"
            value=${appName}
            onInput=${(e) => setAppName(e.target.value)}
            placeholder="My Expo App"
          />
        </label>

        <div class="grid">
          <a href="#/" role="button" class="secondary outline">Cancel</a>
          <button type="submit" aria-busy=${loading} disabled=${loading}>
            ${loading ? 'Creating...' : 'Create App'}
          </button>
        </div>
      </form>
    </article>
  `;
}
