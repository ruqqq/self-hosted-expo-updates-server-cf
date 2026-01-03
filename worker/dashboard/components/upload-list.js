import { useState } from 'preact/hooks';
import { html } from '../htm.js';
import { releaseUpload, rollbackUpload, deleteUpload } from '../api.js';

/**
 * Format bytes to human readable size
 */
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format date to readable string
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString();
}

/**
 * Single upload row component
 */
function UploadRow({ upload, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAction = async (action, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;

    setLoading(true);
    setError('');

    try {
      if (action === 'release') {
        await releaseUpload(upload.id);
      } else if (action === 'rollback') {
        await rollbackUpload(upload.id);
      } else if (action === 'delete') {
        await deleteUpload(upload.id);
      }
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const statusClass = `status-${upload.status}`;

  return html`
    <details>
      <summary>
        <span class="flex justify-between items-center w-full">
          <span>
            <span class=${statusClass}>${upload.status}</span>
            ${' - '}
            <span class="mono">${upload.version}</span>
            ${' / '}
            <span>${upload.releaseChannel}</span>
          </span>
          <small class="secondary">${formatDate(upload.createdAt)}</small>
        </span>
      </summary>

      ${error && html`
        <p style="color: var(--pico-del-color);">${error}</p>
      `}

      <div class="grid">
        <div>
          <small class="secondary">Update ID</small>
          <p class="mono mb-1">${upload.updateId || upload.id}</p>
        </div>
        <div>
          <small class="secondary">Size</small>
          <p class="mb-1">${formatSize(upload.size)}</p>
        </div>
      </div>

      <div class="grid">
        <div>
          <small class="secondary">Git Branch</small>
          <p class="mono mb-1">${upload.gitBranch || '-'}</p>
        </div>
        <div>
          <small class="secondary">Git Commit</small>
          <p class="mono mb-1">${upload.gitCommit || '-'}</p>
        </div>
      </div>

      ${upload.releasedAt && html`
        <div>
          <small class="secondary">Released At</small>
          <p class="mb-1">${formatDate(upload.releasedAt)}</p>
        </div>
      `}

      <div class="flex gap" style="margin-top: 1rem;">
        ${upload.status === 'ready' && html`
          <button
            onClick=${() => handleAction('release', 'Release this update to all users?')}
            disabled=${loading}
            aria-busy=${loading}
          >
            Release
          </button>
        `}

        ${upload.status === 'obsolete' && html`
          <button
            onClick=${() => handleAction('rollback', 'Rollback to this update? The current release will be marked obsolete.')}
            disabled=${loading}
            aria-busy=${loading}
            class="secondary"
          >
            Rollback to this
          </button>
        `}

        ${upload.status === 'released' && html`
          <button disabled class="outline">Currently Released</button>
        `}

        <button
          onClick=${() => handleAction('delete', 'Delete this upload? This cannot be undone.')}
          disabled=${loading}
          class="outline secondary"
        >
          Delete
        </button>
      </div>
    </details>
  `;
}

/**
 * Upload list component
 */
export function UploadList({ uploads, loading, error, onRefresh }) {
  if (loading) {
    return html`<p aria-busy="true">Loading uploads...</p>`;
  }

  if (error) {
    return html`
      <p style="color: var(--pico-del-color);">Error: ${error}</p>
      <button onClick=${onRefresh} class="outline">Retry</button>
    `;
  }

  if (!uploads || uploads.length === 0) {
    return html`
      <p class="secondary">No uploads yet. Use the publish script to upload your first update.</p>
    `;
  }

  // Group by status
  const released = uploads.filter(u => u.status === 'released');
  const ready = uploads.filter(u => u.status === 'ready');
  const obsolete = uploads.filter(u => u.status === 'obsolete');

  return html`
    ${released.length > 0 && html`
      <h4 class="status-released">Released</h4>
      ${released.map(u => html`<${UploadRow} key=${u.id} upload=${u} onRefresh=${onRefresh} />`)}
    `}

    ${ready.length > 0 && html`
      <h4 class="status-ready">Ready to Release</h4>
      ${ready.map(u => html`<${UploadRow} key=${u.id} upload=${u} onRefresh=${onRefresh} />`)}
    `}

    ${obsolete.length > 0 && html`
      <h4 class="status-obsolete">Obsolete</h4>
      ${obsolete.map(u => html`<${UploadRow} key=${u.id} upload=${u} onRefresh=${onRefresh} />`)}
    `}
  `;
}
