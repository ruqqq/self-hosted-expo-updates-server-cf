/**
 * API Client for Expo Updates Server
 * Simple fetch wrapper with JWT authentication
 */

const TOKEN_KEY = 'expo-updates-token';

// Get stored token
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Store token
export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// Check if authenticated
export function isAuthenticated() {
  return !!getToken();
}

// Base fetch wrapper
export async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    ...options.headers,
  };

  // Add auth header if we have a token
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add content-type for JSON bodies
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Handle auth errors
  if (res.status === 401) {
    setToken(null);
    window.location.hash = '#/login';
    throw new Error('Authentication required');
  }

  if (!res.ok) {
    const text = await res.text();
    let message;
    try {
      const json = JSON.parse(text);
      message = json.error || json.message || text;
    } catch {
      message = text;
    }
    throw new Error(message);
  }

  // Handle empty responses
  const text = await res.text();
  if (!text) return null;

  return JSON.parse(text);
}

// ============================================================================
// Auth
// ============================================================================

export async function login(username, password) {
  const result = await api('/authentication', {
    method: 'POST',
    body: { username, password },
  });
  if (result.accessToken) {
    setToken(result.accessToken);
  }
  return result;
}

export function logout() {
  setToken(null);
  window.location.hash = '#/login';
}

// ============================================================================
// Apps
// ============================================================================

export function getApps() {
  return api('/apps');
}

export function getApp(id) {
  return api(`/apps/${encodeURIComponent(id)}`);
}

export function createApp(id, name = null) {
  return api('/apps', {
    method: 'POST',
    body: { id, name: name || id },
  });
}

export function updateApp(id, data) {
  return api(`/apps/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: data,
  });
}

export function deleteApp(id) {
  return api(`/apps/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Uploads
// ============================================================================

export function getUploads(project) {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  return api(`/uploads?${params}`);
}

export function getUpload(id) {
  return api(`/uploads/${encodeURIComponent(id)}`);
}

export function deleteUpload(id) {
  return api(`/uploads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Utils
// ============================================================================

export function releaseUpload(uploadId) {
  return api('/utils/release', {
    method: 'POST',
    body: { uploadId },
  });
}

export function rollbackUpload(uploadId) {
  return api('/utils/rollback', {
    method: 'POST',
    body: { uploadId },
  });
}

export function generateCertificate(appId) {
  return api('/utils/generate-certificate', {
    method: 'POST',
    body: { appId },
  });
}

export function getUploadKey() {
  return api('/utils/upload-key');
}

// ============================================================================
// Stats
// ============================================================================

export function getStats(project) {
  return api(`/stats/${encodeURIComponent(project)}`);
}

// ============================================================================
// Clients
// ============================================================================

export function getClients(project) {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  return api(`/clients?${params}`);
}
