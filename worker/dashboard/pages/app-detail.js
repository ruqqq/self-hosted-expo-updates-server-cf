import { useState, useEffect } from 'preact/hooks';
import { html } from '../htm.js';
import { getApp, getUploads, getStats } from '../api.js';
import { UploadList } from '../components/upload-list.js';
import { CertificateSection, SetupSection, DangerSection } from '../components/config-section.js';

/**
 * App detail page
 */
export function AppDetailPage({ appId, navigate }) {
  const [app, setApp] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadApp = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getApp(appId);
      setApp(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadUploads = async () => {
    setUploadsLoading(true);
    try {
      const result = await getUploads(appId);
      setUploads(result || []);
    } catch (err) {
      console.error('Failed to load uploads:', err);
    } finally {
      setUploadsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const result = await getStats(appId);
      setStats(result);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const refreshAll = () => {
    loadApp();
    loadUploads();
    loadStats();
  };

  useEffect(() => {
    loadApp();
    loadUploads();
    loadStats();
  }, [appId]);

  if (loading) {
    return html`<p aria-busy="true">Loading app...</p>`;
  }

  if (error) {
    return html`
      <article>
        <h2>Error</h2>
        <p style="color: var(--pico-del-color);">${error}</p>
        <div class="flex gap">
          <button onClick=${loadApp}>Retry</button>
          <a href="#/" role="button" class="secondary outline">Back to Apps</a>
        </div>
      </article>
    `;
  }

  if (!app) {
    return html`
      <article>
        <h2>App Not Found</h2>
        <p>The app "${appId}" was not found.</p>
        <a href="#/" role="button">Back to Apps</a>
      </article>
    `;
  }

  return html`
    <div class="flex justify-between items-center" style="margin-bottom: 1rem;">
      <div>
        <a href="#/" class="secondary">← Back to Apps</a>
        <h1 class="mt-0 mb-0">${app.name || app.id}</h1>
        ${app.name && app.name !== app.id && html`
          <small class="mono secondary">${app.id}</small>
        `}
      </div>
      <button onClick=${refreshAll} class="outline secondary">Refresh</button>
    </div>

    ${stats && html`
      <div class="grid" style="margin-bottom: 1rem;">
        <article>
          <small class="secondary">Total Clients</small>
          <p class="mb-0"><strong>${stats.clients?.total || 0}</strong></p>
        </article>
        <article>
          <small class="secondary">Active (24h)</small>
          <p class="mb-0"><strong>${stats.clients?.active24h || 0}</strong></p>
        </article>
        <article>
          <small class="secondary">Platforms</small>
          <p class="mb-0">
            iOS: ${stats.clients?.byPlatform?.ios || 0}
            ${' / '}
            Android: ${stats.clients?.byPlatform?.android || 0}
          </p>
        </article>
      </div>
    `}

    <article>
      <header>
        <h3 class="mb-0">Uploads</h3>
      </header>
      <${UploadList}
        uploads=${uploads}
        loading=${uploadsLoading}
        error=${null}
        onRefresh=${loadUploads}
      />
    </article>

    <article>
      <header>
        <h3 class="mb-0">Configuration</h3>
      </header>

      <${CertificateSection} app=${app} onRefresh=${loadApp} />

      <${SetupSection} app=${app} />

      <${DangerSection} app=${app} navigate=${navigate} />
    </article>
  `;
}
