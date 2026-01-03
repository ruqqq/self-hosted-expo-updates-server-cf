/**
 * Expo Updates Protocol API Routes
 *
 * These are the public endpoints that Expo clients use to check for and download updates.
 * No authentication required - these must be accessible by the mobile app.
 *
 * Endpoints:
 * - GET /api/manifest - Returns update manifest (multipart/mixed format)
 * - GET /api/assets   - Returns asset files from R2
 */

import { Hono } from "hono"
import { drizzle } from "drizzle-orm/d1"
import { eq, and, desc } from "drizzle-orm"

import type {
  Env,
  ExpoRequestContext,
  ExpoManifest,
  ExpoAsset,
  ManifestExtensions,
} from "../types"
import { uploads, clients, apps } from "../db/schema"
import {
  parseExpoRequest,
  createMultipartResponse,
  signManifest,
  hashAsset,
  md5Hash,
} from "../services/manifest"

const api = new Hono<{ Bindings: Env }>()

// ============================================================================
// GET /api/manifest
// ============================================================================
// Returns the update manifest for the requesting Expo client.
// Response format: multipart/mixed with manifest JSON and extensions JSON.

api.get("/manifest", async (c) => {
  const db = drizzle(c.env.DB)

  // 1. Parse request parameters from headers/query
  const params = parseExpoRequest(c)
  if ("error" in params) {
    return c.json({ error: params.error }, 400)
  }

  const {
    project,
    platform,
    runtimeVersion,
    releaseChannel,
    expectSignature,
    clientId,
  } = params

  // 2. Track client device (async, don't block response)
  if (clientId) {
    trackClient(db, params).catch(console.error)
  }

  // 3. Query for latest released update matching criteria
  const [update] = await db
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.project, project),
        eq(uploads.version, runtimeVersion),
        eq(uploads.releaseChannel, releaseChannel),
        eq(uploads.status, "released"),
      ),
    )
    .orderBy(desc(uploads.releasedAt))
    .limit(1)

  // 4. No update found
  if (!update) {
    return c.json({ message: "No updates available" }, 404)
  }

  // 5. Parse cached metadata
  const metadata = JSON.parse(update.metadataJson || "{}")
  const appJson = JSON.parse(update.appJson || "{}")
  const platformMetadata = metadata.fileMetadata?.[platform]

  if (!platformMetadata) {
    return c.json({ error: `No ${platform} assets in update` }, 404)
  }

  // 6. Build asset list
  const publicUrl = c.env.PUBLIC_URL || `https://${c.req.header("host")}`
  const basePath = update.r2Path

  // Build launch asset (main JS bundle)
  const bundlePath = `${basePath}/${platformMetadata.bundle}`
  const bundleObject = await c.env.R2.get(bundlePath)

  if (!bundleObject) {
    return c.json({ error: "Bundle not found" }, 500)
  }

  const bundleData = await bundleObject.arrayBuffer()
  const launchAsset: ExpoAsset = {
    hash: await hashAsset(bundleData),
    key: md5Hash(bundleData),
    fileExtension: ".bundle",
    contentType: "application/javascript",
    url: `${publicUrl}/api/assets?asset=${encodeURIComponent(bundlePath)}&contentType=${encodeURIComponent("application/javascript")}&platform=${platform}`,
  }

  // Build other assets
  const assets: ExpoAsset[] = []
  for (const asset of platformMetadata.assets || []) {
    const assetPath = `${basePath}/${asset.path}`
    const assetObject = await c.env.R2.get(assetPath)

    if (assetObject) {
      const assetData = await assetObject.arrayBuffer()
      const contentType = getContentType(asset.ext)

      assets.push({
        hash: await hashAsset(assetData),
        key: md5Hash(assetData),
        fileExtension: asset.ext,
        contentType,
        url: `${publicUrl}/api/assets?asset=${encodeURIComponent(assetPath)}&contentType=${encodeURIComponent(contentType)}&platform=${platform}`,
      })
    }
  }

  // 7. Build manifest
  const manifest: ExpoManifest = {
    id: update.updateId || update.id,
    createdAt: new Date(update.createdAt!).toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: {
      expoClient: appJson,
    },
  }

  // 8. Sign manifest if requested
  let signature: string | undefined
  if (expectSignature) {
    const [app] = await db
      .select()
      .from(apps)
      .where(eq(apps.id, project))
      .limit(1)

    if (app?.privateKey) {
      signature = await signManifest(JSON.stringify(manifest), app.privateKey)
    }
  }

  // 9. Build extensions
  const extensions: ManifestExtensions = {
    assetRequestHeaders: {},
  }

  // 10. Return multipart response
  return createMultipartResponse(
    manifest,
    extensions,
    signature,
    params.protocolVersion,
  )
})

// ============================================================================
// GET /api/assets
// ============================================================================
// Returns asset files from R2 storage.

api.get("/assets", async (c) => {
  const assetPath = c.req.query("asset")
  const contentType = c.req.query("contentType") || "application/octet-stream"

  if (!assetPath) {
    return c.json({ error: "Missing asset parameter" }, 400)
  }

  // Security: Only serve files from updates/ path
  if (!assetPath.startsWith("updates/")) {
    return c.json({ error: "Invalid asset path" }, 403)
  }

  // Security: Don't serve config files
  if (assetPath.endsWith("app.json") || assetPath.endsWith("package.json")) {
    return c.json({ error: "Access denied" }, 403)
  }

  // Fetch from R2
  const object = await c.env.R2.get(assetPath)

  if (!object) {
    return c.json({ error: "Asset not found" }, 404)
  }

  // Return with proper headers
  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": object.size.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function trackClient(
  db: ReturnType<typeof drizzle>,
  params: ExpoRequestContext,
) {
  const now = new Date()

  // Upsert client record
  await db
    .insert(clients)
    .values({
      id: params.clientId!,
      project: params.project,
      version: params.runtimeVersion,
      platform: params.platform,
      releaseChannel: params.releaseChannel,
      embeddedUpdate: params.embeddedUpdateId,
      currentUpdate: params.currentUpdateId,
      updateCount: 1,
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoUpdate({
      target: clients.id,
      set: {
        version: params.runtimeVersion,
        releaseChannel: params.releaseChannel,
        currentUpdate: params.currentUpdateId,
        lastSeen: now,
        // Increment update count (SQLite doesn't have easy increment, so we use a subquery)
        // For simplicity, we'll handle this in application logic if needed
      },
    })
}

function getContentType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  }
  return mimeTypes[ext] || "application/octet-stream"
}

export { api as apiRoutes }
