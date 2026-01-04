/**
 * Utils Routes
 *
 * Utility endpoints for releasing updates, rollbacks, etc.
 */

import { Hono } from "hono"
import { jwt } from "hono/jwt"
import { drizzle } from "drizzle-orm/d1"
import { eq, and, ne } from "drizzle-orm"

import type { Env } from "../types"
import { uploads } from "../db/schema"

const utilsRouter = new Hono<{ Bindings: Env }>()

// Apply JWT middleware to all routes
utilsRouter.use("*", (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
})

/**
 * POST /utils/release
 * Release an upload (change status from 'ready' to 'released').
 * Also marks previous releases as 'obsolete'.
 */
utilsRouter.post("/release", async (c) => {
  const { uploadId } = await c.req.json<{ uploadId: string }>()

  if (!uploadId) {
    return c.json({ error: "uploadId is required" }, 400)
  }

  const db = drizzle(c.env.DB)

  // Get the upload to release
  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1)

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404)
  }

  if (upload.status === "released") {
    return c.json({ error: "Upload is already released" }, 400)
  }

  // Mark previous releases for this project/version/channel as obsolete
  await db
    .update(uploads)
    .set({ status: "obsolete", updatedAt: new Date() })
    .where(
      and(
        eq(uploads.project, upload.project),
        eq(uploads.version, upload.version),
        eq(uploads.releaseChannel, upload.releaseChannel),
        eq(uploads.status, "released"),
        ne(uploads.id, uploadId),
      ),
    )

  // Release the new upload
  await db
    .update(uploads)
    .set({
      status: "released",
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
utilsRouter.post("/rollback", async (c) => {
  const { uploadId } = await c.req.json<{ uploadId: string }>()

  if (!uploadId) {
    return c.json({ error: "uploadId is required" }, 400)
  }

  const db = drizzle(c.env.DB)

  // Get the upload to rollback to
  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1)

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404)
  }

  // Mark current release as obsolete
  await db
    .update(uploads)
    .set({ status: "obsolete", updatedAt: new Date() })
    .where(
      and(
        eq(uploads.project, upload.project),
        eq(uploads.version, upload.version),
        eq(uploads.releaseChannel, upload.releaseChannel),
        eq(uploads.status, "released"),
      ),
    )

  // Release the rollback target
  await db
    .update(uploads)
    .set({
      status: "released",
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
utilsRouter.get("/upload-key", async (c) => {
  return c.json({ uploadKey: c.env.UPLOAD_KEY })
})

export { utilsRouter as utilsRoutes }
