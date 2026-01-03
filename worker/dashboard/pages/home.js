import { useState, useEffect } from 'preact/hooks';
import { html } from '../htm.js';
import { getApps, getStats } from '../api.js';

/**
 * App card component with stats
 */
function AppCard({ app, navigate }) {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    getStats(app.id)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoadingStats(false));
  }, [app.id]);

  return html`
    <article>
      <header class="flex justify-between items-center">
        <h3 class="mb-0">${app.name || app.id}</h3>
        <a href="#/app/${encodeURIComponent(app.id)}" role="button" class="outline">
          Manage
        </a>
      </header>

      <div class="grid">
        <div>
          <small class="secondary">App ID</small>
          <p class="mono mb-0">${app.id}</p>
        </div>
        <div>
          <small class="secondary">Certificate</small>
          <p class="mb-0">${app.certificate ? 'Configured' : 'Not configured'}</p>
        </div>
      </div>

      ${loadingStats ? html`
        <p aria-busy="true" class="secondary">Loading stats...</p>
      ` : stats ? html`
        <hr />
        <div class="grid">
          <div>
            <small class="secondary">Total Clients</small>
            <p class="mb-0"><strong>${stats.clients?.total || 0}</strong></p>
          </div>
          <div>
            <small class="secondary">Active (24h)</small>
            <p class="mb-0"><strong>${stats.clients?.active24h || 0}</strong></p>
          </div>
          <div>
            <small class="secondary">Uploads</small>
            <p class="mb-0">
              <span class="status-released">${stats.uploads?.released || 0} released</span>
              ${' / '}
              <span class="status-ready">${stats.uploads?.ready || 0} ready</span>
            </p>
          </div>
        </div>
      ` : null}
    </article>
  `;
}

/**
 * Home page - list of apps
 */
export function HomePage({ navigate }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadApps = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getApps();
      setApps(result || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
  }, []);

  if (loading) {
    return html`<p aria-busy="true">Loading apps...</p>`;
  }

  if (error) {
    return html`
      <article>
        <p style="color: var(--pico-del-color);">Error: ${error}</p>
        <button onClick=${loadApps}>Retry</button>
      </article>
    `;
  }

  return html`
    <div class="flex justify-between items-center" style="margin-bottom: 1rem;">
      <h1 class="mb-0">My Apps</h1>
      <div class="flex gap">
        <button onClick=${loadApps} class="outline secondary">Refresh</button>
        <a href="#/new" role="button">New App</a>
      </div>
    </div>

    ${apps.length === 0 ? html`
      <article>
        <h3>No apps yet</h3>
        <p>Create your first app to start managing Expo updates.</p>
        <a href="#/new" role="button">Create App</a>
      </article>
    ` : html`
      ${apps.map(app => html`
        <${AppCard} key=${app.id} app=${app} navigate=${navigate} />
      `)}
    `}
  `;
}
