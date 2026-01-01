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
import { eq, and, desc } from "drizzle-orm"

import type { Env } from "../types"
import { uploads, type NewUpload } from "../db/schema"
import { uploadKeyMiddleware } from "../middleware/auth"
import { hashToUuid, hashAsset } from "../services/manifest"

// Type for uploaded file entries
interface UploadedFile {
  path: string
  data: ArrayBuffer
}

const uploadsRouter = new Hono<{ Bindings: Env }>()

// ============================================================================
// PROTECTED ROUTES (JWT)
// ============================================================================

// Apply JWT to list/update/delete operations
const protectedRoutes = new Hono<{ Bindings: Env }>()
protectedRoutes.use("*", (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
})

/**
 * GET /uploads
 * List uploads, optionally filtered by project/version/channel.
 */
protectedRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB)
  const project = c.req.query("project")
  const version = c.req.query("version")
  const channel = c.req.query("releaseChannel")

  let query = db.select().from(uploads)

  // Build where conditions
  const conditions = []
  if (project) conditions.push(eq(uploads.project, project))
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
protectedRoutes.get("/:id", async (c) => {
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
protectedRoutes.patch("/:id", async (c) => {
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
protectedRoutes.delete("/:id", async (c) => {
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

// Mount protected routes
uploadsRouter.route("/", protectedRoutes)

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
  const project = c.req.header("project")
  const version = c.req.header("version")
  const releaseChannel = c.req.header("release-channel")
  const gitBranch = c.req.header("git-branch")
  const gitCommit = c.req.header("git-commit")

  if (!project || !version || !releaseChannel) {
    return c.json(
      {
        error: "Missing required headers: project, version, release-channel",
      },
      400,
    )
  }

  const db = drizzle(c.env.DB)
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

  // Create database record
  const newUpload: NewUpload = {
    id: uploadId,
    project,
    version,
    releaseChannel,
    status: "ready",
    r2Path,
    metadataJson,
    appJson,
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
      status: "ready",
      message: "Upload successful. Use the dashboard to release this update.",
    },
    201,
  )
})

export { uploadsRouter as uploadsRoutes }
