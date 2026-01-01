/**
 * Utils Routes
 *
 * Utility endpoints for releasing updates, generating certificates, etc.
 */

import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, ne } from 'drizzle-orm'

import type { Env } from '../types'
import { uploads, apps } from '../db/schema'

const utilsRouter = new Hono<{ Bindings: Env }>()

// Apply JWT middleware to all routes
utilsRouter.use('*', (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
})

/**
 * POST /utils/release
 * Release an upload (change status from 'ready' to 'released').
 * Also marks previous releases as 'obsolete'.
 */
utilsRouter.post('/release', async (c) => {
  const { uploadId } = await c.req.json<{ uploadId: string }>()

  if (!uploadId) {
    return c.json({ error: 'uploadId is required' }, 400)
  }

  const db = drizzle(c.env.DB)

  // Get the upload to release
  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1)

  if (!upload) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  if (upload.status === 'released') {
    return c.json({ error: 'Upload is already released' }, 400)
  }

  // Mark previous releases for this project/version/channel as obsolete
  await db
    .update(uploads)
    .set({ status: 'obsolete', updatedAt: new Date() })
    .where(and(
      eq(uploads.project, upload.project),
      eq(uploads.version, upload.version),
      eq(uploads.releaseChannel, upload.releaseChannel),
      eq(uploads.status, 'released'),
      ne(uploads.id, uploadId)
    ))

  // Release the new upload
  await db
    .update(uploads)
    .set({
      status: 'released',
      releasedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(uploads.id, uploadId))

  return c.json({
    success: true,
    message: `Upload ${uploadId} has been released`,
  })
})

/**
 * POST /utils/rollback
 * Rollback to a previous upload.
 */
utilsRouter.post('/rollback', async (c) => {
  const { uploadId } = await c.req.json<{ uploadId: string }>()

  if (!uploadId) {
    return c.json({ error: 'uploadId is required' }, 400)
  }

  const db = drizzle(c.env.DB)

  // Get the upload to rollback to
  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1)

  if (!upload) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  // Mark current release as obsolete
  await db
    .update(uploads)
    .set({ status: 'obsolete', updatedAt: new Date() })
    .where(and(
      eq(uploads.project, upload.project),
      eq(uploads.version, upload.version),
      eq(uploads.releaseChannel, upload.releaseChannel),
      eq(uploads.status, 'released')
    ))

  // Release the rollback target
  await db
    .update(uploads)
    .set({
      status: 'released',
      releasedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(uploads.id, uploadId))

  return c.json({
    success: true,
    message: `Rolled back to upload ${uploadId}`,
  })
})

/**
 * GET /utils/upload-key
 * Get the upload key (for display in dashboard).
 */
utilsRouter.get('/upload-key', async (c) => {
  return c.json({ uploadKey: c.env.UPLOAD_KEY })
})

/**
 * POST /utils/generate-certificate
 * Generate a self-signed certificate for code signing.
 *
 * Note: This is a simplified version. Full certificate generation
 * with Web Crypto requires additional ASN.1 encoding.
 */
utilsRouter.post('/generate-certificate', async (c) => {
  const { appId } = await c.req.json<{ appId: string }>()

  if (!appId) {
    return c.json({ error: 'appId is required' }, 400)
  }

  try {
    // Generate RSA key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )

    // Export private key as PKCS#8
    const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
    const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)))
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`

    // Export public key as SPKI
    const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey)
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)))
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`

    // Update app with the new keys
    const db = drizzle(c.env.DB)
    await db
      .update(apps)
      .set({
        privateKey: privateKeyPem,
        certificate: publicKeyPem, // Note: This is the public key, not a full certificate
        updatedAt: new Date(),
      })
      .where(eq(apps.id, appId))

    return c.json({
      success: true,
      message: 'Key pair generated and saved',
      publicKey: publicKeyPem,
      // Note: For Expo code signing, you'll need a proper X.509 certificate.
      // Consider using a tool like openssl for production certificates.
      warning: 'This generates a key pair, not a full X.509 certificate. For production, use proper certificate generation.',
    })
  } catch (error) {
    console.error('Certificate generation failed:', error)
    return c.json({ error: 'Failed to generate certificate' }, 500)
  }
})

export { utilsRouter as utilsRoutes }
