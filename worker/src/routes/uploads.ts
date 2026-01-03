/**
 * Uploads Routes
 *
 * Handles upload management and the publish endpoint.
 *
 * Endpoints:
 * - GET /uploads     - List uploads (requires JWT)
 * - POST /upload     - Upload new update (requires upload-key)
 * - PATCH /uploads/:id - Update upload status (requires JWT)
 * - DELETE /uploads/:id - Delete upload (requires JWT)
 */

import { Hono } from "hono"
import { jwt } from "hono/jwt"
import { drizzle } from "drizzle-orm/d1"
import { eq, and, desc, sql } from "drizzle-orm"

import type { Env } from "../types"
import { uploads, type NewUpload, type UploadPlatform } from "../db/schema"
import { uploadKeyMiddleware } from "../middleware/auth"
import { hashToUuid, hashAsset, md5Hash } from "../services/manifest"
import { resolveAppId } from "../services/helpers"

// Type for uploaded file entries
interface UploadedFile {
  path: string
  data: ArrayBuffer
}

const uploadsRouter = new Hono<{ Bindings: Env }>()

// ============================================================================
// JWT Middleware helper
// ============================================================================

const jwtMiddlewareHandler = (c: any, next: any) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
}

/**
 * GET /uploads
 * List uploads, optionally filtered by project/version/channel.
 * Project filter is case-insensitive.
 */
uploadsRouter.get("/", jwtMiddlewareHandler, async (c) => {
  const db = drizzle(c.env.DB)
  const project = c.req.query("project")
  const version = c.req.query("version")
  const channel = c.req.query("releaseChannel")

  let query = db.select().from(uploads)

  // Build where conditions
  const conditions = []
  // Case-insensitive project filter
  if (project) conditions.push(sql`LOWER(${uploads.project}) = LOWER(${project})`)
  if (version) conditions.push(eq(uploads.version, version))
  if (channel) conditions.push(eq(uploads.releaseChannel, channel))

  if (conditions.length > 0) {
    query = (query.where(and(...conditions)) as typeof query)
  }

  const results = await query.orderBy(desc(uploads.createdAt))
  return c.json(results)
})

/**
 * GET /uploads/:id
 * Get single upload by ID.
 */
uploadsRouter.get("/:id", jwtMiddlewareHandler, async (c) => {
  const id = c.req.param("id")
  const db = drizzle(c.env.DB)

  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, id))
    .limit(1)

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404)
  }

  return c.json(upload)
})

/**
 * PATCH /uploads/:id
 * Update upload (mainly for status changes like release/rollback).
 */
uploadsRouter.patch("/:id", jwtMiddlewareHandler, async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<Partial<NewUpload>>()
  const db = drizzle(c.env.DB)

  const [existing] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, id))
    .limit(1)

  if (!existing) {
    return c.json({ error: "Upload not found" }, 404)
  }

  const updateData: Partial<NewUpload> = {
    ...body,
    updatedAt: new Date(),
  }

  // If releasing, set releasedAt timestamp
  if (body.status === "released" && existing.status !== "released") {
    updateData.releasedAt = new Date()
  }

  await db.update(uploads).set(updateData).where(eq(uploads.id, id))

  return c.json({ success: true })
})

/**
 * DELETE /uploads/:id
 * Delete upload and its R2 files.
 */
uploadsRouter.delete("/:id", jwtMiddlewareHandler, async (c) => {
  const id = c.req.param("id")
  const db = drizzle(c.env.DB)

  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, id))
    .limit(1)

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404)
  }

  // Delete from R2
  const r2Path = upload.r2Path
  if (r2Path) {
    // List and delete all objects in the path
    const objects = await c.env.R2.list({ prefix: r2Path })
    for (const obj of objects.objects) {
      await c.env.R2.delete(obj.key)
    }
  }

  // Delete from database
  await db.delete(uploads).where(eq(uploads.id, id))

  return c.json({ success: true })
})

// ============================================================================
// UPLOAD ENDPOINT (upload-key)
// ============================================================================

/**
 * POST /upload
 * Receive new update from publish script.
 *
 * This is a simplified version that expects pre-extracted files.
 * The publish script should upload files individually or as a structured payload.
 */
uploadsRouter.post("/", uploadKeyMiddleware, async (c) => {
  const requestedProject = c.req.header("project")
  const version = c.req.header("version")
  const releaseChannel = c.req.header("release-channel")
  const gitBranch = c.req.header("git-branch")
  const gitCommit = c.req.header("git-commit")
  const platformHeader = c.req.header("platform")

  // Validate platform header if provided
  const validPlatforms: UploadPlatform[] = ["ios", "android", "all"]
  const platform: UploadPlatform =
    platformHeader && validPlatforms.includes(platformHeader as UploadPlatform)
      ? (platformHeader as UploadPlatform)
      : "all"

  if (!requestedProject || !version || !releaseChannel) {
    return c.json(
      {
        error: "Missing required headers: project, version, release-channel",
      },
      400,
    )
  }

  const db = drizzle(c.env.DB)

  // Resolve actual app ID (case-insensitive)
  const project = await resolveAppId(db, requestedProject)
  if (!project) {
    return c.json({ error: `App not found: ${requestedProject}` }, 404)
  }
  const uploadId = crypto.randomUUID()
  const r2Path = `updates/${project}/${version}/${uploadId}`

  // Parse multipart form data
  const formData = await c.req.formData()

  // Handle file uploads
  // Expected format: metadata.json, bundles/*, assets/*
  const files: UploadedFile[] = []
  let metadataJson: string | null = null
  let appJson: string | null = null

  for (const [key, value] of formData.entries()) {
    // Check if value is a file (has arrayBuffer method)
    if (typeof value === "object" && value !== null && "arrayBuffer" in value) {
      const file = value as Blob
      const data = await file.arrayBuffer()
      const filePath = `${r2Path}/${key}`

      // Store in R2
      await c.env.R2.put(filePath, data)
      files.push({ path: filePath, data })

      // Extract metadata
      if (key === "metadata.json") {
        metadataJson = new TextDecoder().decode(data)
      }
      if (key === "app.json") {
        const appJsonFull = JSON.parse(new TextDecoder().decode(data))
        appJson = JSON.stringify(appJsonFull.expo || appJsonFull)
      }
    }
  }

  // Calculate update ID from metadata hash
  let updateId = uploadId
  if (metadataJson) {
    const metadataBuffer = new TextEncoder().encode(metadataJson)
    const hash = await hashAsset(metadataBuffer.buffer as ArrayBuffer)
    updateId = hashToUuid(hash)
  }

  // Pre-compute asset hashes to avoid fetching from R2 on manifest requests
  let assetsManifest: string | null = null
  if (metadataJson) {
    const metadata = JSON.parse(metadataJson)
    const fileDataMap = new Map<string, ArrayBuffer>()
    for (const f of files) {
      // Store by relative path (without r2Path prefix)
      const relativePath = f.path.replace(`${r2Path}/`, "")
      fileDataMap.set(relativePath, f.data)
    }

    const platformManifests: Record<string, unknown> = {}

    for (const plat of ["ios", "android"] as const) {
      const platformMeta = metadata.fileMetadata?.[plat]
      if (!platformMeta) continue

      // Compute launch asset (bundle) hash
      const bundleData = fileDataMap.get(platformMeta.bundle)
      let launchAsset = null
      if (bundleData) {
        launchAsset = {
          hash: await hashAsset(bundleData),
          key: md5Hash(bundleData),
          fileExtension: ".bundle",
          contentType: "application/javascript",
        }
      }

      // Compute asset hashes
      const assets = []
      for (const asset of platformMeta.assets || []) {
        const assetData = fileDataMap.get(asset.path)
        if (assetData) {
          assets.push({
            path: asset.path,
            ext: asset.ext,
            hash: await hashAsset(assetData),
            key: md5Hash(assetData),
          })
        }
      }

      platformManifests[plat] = { launchAsset, assets }
    }

    assetsManifest = JSON.stringify(platformManifests)
  }

  // Create database record
  const newUpload: NewUpload = {
    id: uploadId,
    project,
    version,
    releaseChannel,
    platform,
    status: "ready",
    r2Path,
    metadataJson,
    appJson,
    assetsManifest,
    updateId,
    gitBranch,
    gitCommit,
    size: files.reduce((sum, f) => sum + f.data.byteLength, 0),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  await db.insert(uploads).values(newUpload)

  return c.json(
    {
      id: uploadId,
      updateId,
      platform,
      status: "ready",
      message: "Upload successful. Use the dashboard to release this update.",
    },
    201,
  )
})

export { uploadsRouter as uploadsRoutes }
