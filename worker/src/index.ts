/**
 * Self-Hosted Expo Updates Server - Cloudflare Worker
 *
 * Main entry point for the Hono-based API server.
 * Replaces the original FeathersJS + Express server.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'

import type { Env } from './types'

// Route imports
import { apiRoutes } from './routes/api'
import { authRoutes } from './routes/auth'
import { appsRoutes } from './routes/apps'
import { uploadsRoutes } from './routes/uploads'
import { clientsRoutes } from './routes/clients'
import { statsRoutes } from './routes/stats'
import { utilsRoutes } from './routes/utils'

// Create Hono app with typed environment bindings
const app = new Hono<{ Bindings: Env }>()

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================

// Security headers
app.use('*', secureHeaders())

// CORS - allow all origins for Expo clients
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    // Expo-specific headers
    'expo-project',
    'expo-platform',
    'expo-runtime-version',
    'expo-channel-name',
    'expo-protocol-version',
    'expo-expect-signature',
    'expo-embedded-update-id',
    'expo-current-update-id',
    'eas-client-id',
    // Upload headers
    'project',
    'version',
    'release-channel',
    'upload-key',
    'git-branch',
    'git-commit',
  ],
  exposeHeaders: [
    'expo-protocol-version',
    'expo-sfv-version',
    'expo-signature',
  ],
}))

// Request logging (development)
app.use('*', logger())

// Pretty JSON responses
app.use('*', prettyJSON())

// ============================================================================
// PUBLIC ROUTES (No Authentication)
// ============================================================================

// Health check
app.get('/status', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0-cf',
  })
})

// Expo Updates Protocol endpoints
app.route('/api', apiRoutes)

// ============================================================================
// AUTHENTICATED ROUTES
// ============================================================================

// Authentication (login/logout)
app.route('/authentication', authRoutes)

// Protected API routes (require JWT)
app.route('/apps', appsRoutes)
app.route('/uploads', uploadsRoutes)
app.route('/clients', clientsRoutes)
app.route('/stats', statsRoutes)
app.route('/utils', utilsRoutes)

// Upload endpoint (requires upload-key, not JWT)
app.route('/upload', uploadsRoutes)

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.onError((err, c) => {
  console.error('Unhandled error:', err)

  if (err.message.includes('Unauthorized')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (err.message.includes('Not Found')) {
    return c.json({ error: 'Not Found' }, 404)
  }

  return c.json({
    error: 'Internal Server Error',
    message: err.message,
  }, 500)
})

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404)
})

// ============================================================================
// EXPORT
// ============================================================================

export default app
