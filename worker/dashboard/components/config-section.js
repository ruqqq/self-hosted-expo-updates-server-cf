import { useState, useEffect } from 'preact/hooks';
import { html } from '../htm.js';
import { generateCertificate, updateApp, getUploadKey } from '../api.js';

/**
 * Download text as file
 */
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Certificate configuration section
 */
export function CertificateSection({ app, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleGenerate = async () => {
    if (!confirm('Generate a new code signing key pair? This will overwrite any existing keys.')) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await generateCertificate(app.id);
      setSuccess('Key pair generated successfully!');
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return html`
    <details>
      <summary><strong>Code Signing</strong></summary>

      ${error && html`<p style="color: var(--pico-del-color);">${error}</p>`}
      ${success && html`<p style="color: var(--pico-ins-color);">${success}</p>`}

      ${app.certificate ? html`
        <p style="color: var(--pico-ins-color);">Certificate configured</p>

        <label>
          Public Key / Certificate
          <textarea readonly rows="6" class="mono">${app.certificate}</textarea>
        </label>

        <div class="flex gap">
          <button
            onClick=${() => downloadFile(app.certificate, `${app.id}-certificate.pem`)}
            class="outline"
          >
            Download Certificate
          </button>
          <button
            onClick=${handleGenerate}
            disabled=${loading}
            aria-busy=${loading}
            class="secondary"
          >
            Regenerate Keys
          </button>
        </div>

        <p class="secondary">
          <small>Note: The private key is stored securely on the server and used for signing manifests.</small>
        </p>
      ` : html`
        <p class="secondary">No certificate configured. Generate a key pair for code signing.</p>
        <button
          onClick=${handleGenerate}
          disabled=${loading}
          aria-busy=${loading}
        >
          Generate Key Pair
        </button>
      `}
    </details>
  `;
}

/**
 * Setup instructions section
 */
export function SetupSection({ app }) {
  const [uploadKey, setUploadKey] = useState('');
  const [loadingKey, setLoadingKey] = useState(false);

  useEffect(() => {
    setLoadingKey(true);
    getUploadKey()
      .then(result => setUploadKey(result.uploadKey || ''))
      .catch(() => setUploadKey(''))
      .finally(() => setLoadingKey(false));
  }, []);

  const baseUrl = window.location.origin;
  const manifestUrl = `${baseUrl}/api/manifest/${app.id}/CHANNEL`;

  const appJsonConfig = `{
  "expo": {
    "runtimeVersion": "1.0.0",
    "updates": {
      "url": "${manifestUrl.replace('/CHANNEL', '/production')}",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 30000
    }${app.certificate ? `,
    "extra": {
      "eas": {
        "projectId": "${app.id}"
      }
    }` : ''}
  }
}`;

  const envFile = `# Expo Updates Server Configuration
# Add this file to your Expo project root

EXPO_RELEASE_CHANNEL=production
EXPO_UPLOAD_KEY=${uploadKey || 'YOUR_UPLOAD_KEY'}
EXPO_API_SERVER=${baseUrl}

# Optional: Set this if using runtimeVersion policy in app.json
# EXPO_RUNTIME_VERSION=1.0.0`;

  const publishScript = `# Download the publish script
curl -o expo-publish-selfhosted.sh ${baseUrl}/expo-publish-selfhosted.sh
chmod +x expo-publish-selfhosted.sh

# Option 1: Use .env file (recommended)
# Create .env in your project root, then run:
./expo-publish-selfhosted.sh

# Option 2: Pass arguments directly
./expo-publish-selfhosted.sh production . ${uploadKey || 'YOUR_UPLOAD_KEY'} ${baseUrl}`;

  return html`
    <details>
      <summary><strong>Setup Instructions</strong></summary>

      <h4>1. Configure app.json</h4>
      <p>Add the following to your Expo app's <code>app.json</code>:</p>
      <pre>${appJsonConfig}</pre>
      <button
        onClick=${() => navigator.clipboard?.writeText(appJsonConfig)}
        class="outline secondary"
      >
        Copy to Clipboard
      </button>

      <hr />

      <h4>2. Create .env file</h4>
      <p>Add this <code>.env</code> file to your Expo project root:</p>
      <pre>${envFile}</pre>
      <div class="flex gap">
        <button
          onClick=${() => navigator.clipboard?.writeText(envFile)}
          class="outline secondary"
        >
          Copy to Clipboard
        </button>
        <button
          onClick=${() => downloadFile(envFile, '.env')}
          class="outline secondary"
        >
          Download .env
        </button>
      </div>
      <small class="secondary">Remember to add <code>.env</code> to your <code>.gitignore</code>!</small>

      <hr />

      <h4>3. Publish Updates</h4>
      <p>Download and run the publish script:</p>
      <pre>${publishScript}</pre>
      <button
        onClick=${() => navigator.clipboard?.writeText(publishScript)}
        class="outline secondary"
      >
        Copy to Clipboard
      </button>

      <hr />

      <h4>4. Manifest URL</h4>
      <p>The manifest URL pattern for this app:</p>
      <pre class="mono">${manifestUrl}</pre>
      <small class="secondary">Replace CHANNEL with your release channel (e.g., production, staging)</small>
    </details>
  `;
}

/**
 * Delete app section
 */
export function DangerSection({ app, navigate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!confirm(`Delete app "${app.id}"? This will also delete all uploads and cannot be undone.`)) {
      return;
    }

    // Double confirm
    const confirmText = prompt(`Type "${app.id}" to confirm deletion:`);
    if (confirmText !== app.id) {
      alert('Deletion cancelled - app ID did not match.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await import('../api.js').then(api => api.deleteApp(app.id));
      navigate('#/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return html`
    <details>
      <summary><strong style="color: var(--pico-del-color);">Danger Zone</strong></summary>

      ${error && html`<p style="color: var(--pico-del-color);">${error}</p>`}

      <p>Permanently delete this app and all its uploads.</p>
      <button
        onClick=${handleDelete}
        disabled=${loading}
        aria-busy=${loading}
        class="secondary"
        style="background: var(--pico-del-color);"
      >
        Delete App
      </button>
    </details>
  `;
}
